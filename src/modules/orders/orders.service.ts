import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, OrderStatus, OrderCreator } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderDispatchService, ServiceLocation } from '../order-dispatch/order-dispatch.service';
import { assertCanManageTechnicians, isOrderStaff } from '../auth/role-policy';
import { createWithUniqueReference } from './order-reference';
import { acceptanceStamp, completionStamp } from './order-view';
import { CreateCustomOrderDto } from './dto/create-custom-order.dto';
import { isCustomServiceId } from '../order-placement/custom-service';
import { providerOrderChargePercent, readProviderOrderCharge } from '../platform-settings/platform-settings.service';
import {
  UpdateOrderDto,
  UpdateOrderStatusDto,
} from './dto/update-order-status.dto';
import {
  ORDER_RELATIONS_INCLUDE,
  calculateOrderPrices,
  commissionFor,
  handleCommissionBalance,
  providerCommissionPercent,
  assertProvider,
  assertCustomer,
  assertService,
  assertTechnician,
} from './orders.helpers';

/**
 * Who created an order, recorded on it as a tag. `ownProviderId`: a provider creating an order for their own
 * customer; it is given to that provider directly and charged by the admin's provider-order rule.
 */
export interface OrderOrigin {
  createdByRole: OrderCreator;
  createdById: string;
  ownProviderId?: string;
}

/** Platform staff who may read any order. */

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: OrderDispatchService,
  ) {}

  /**
   * `serviceLocation` is where the work will be done (the customer's choice on the order, not their
   * profile address). It decides which providers hear about the order.
   */
  /**
   * `options.serviceIds`: every sub-service of a cart order (providers must offer all of them).
   * `options.isPricePending`: a customer's custom order, priced later by the provider's accepted quote.
   */
  async create(data: CreateCustomOrderDto, user?: { id: string; role: UserRole }, serviceLocation?: ServiceLocation, options: { serviceIds?: string[]; isPricePending?: boolean; origin?: OrderOrigin } = {}) {
    // A customer (or anyone else) can't choose the technician; only an admin assigns one.
    if (data.technicianId !== undefined) assertCanManageTechnicians(user?.role);

    // An admin's custom order hangs off the hidden (inactive) custom service on purpose.
    if (!(await isCustomServiceId(this.prisma, data.serviceId))) await assertService(this.prisma, data.serviceId);

    // 1. Resolve Customer ID from input or authenticated session
    let customerId = data.customerId;
    if (!customerId && user) {
      const customer = await this.prisma.customerProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!customer) {
        const createdCustomer = await this.prisma.customerProfile.create({
          data: { userId: user.id },
          select: { id: true },
        });
        customerId = createdCustomer.id;
      } else {
        customerId = customer.id;
      }
    }

    if (!customerId) {
      throw new BadRequestException('Customer profile is required to place an order');
    }
    await assertCustomer(this.prisma, customerId);
    const customerAccount = await this.prisma.customerProfile.findUnique({ where: { id: customerId }, select: { user: { select: { isRestricted: true } } } });
    if (customerAccount?.user.isRestricted) {
      throw new ForbiddenException('This account is restricted from placing new orders. Please contact support.');
    }

    // 2. Matching. Without a named provider the order is offered to a group of eligible providers at once
    // (see OrderDispatchService); the first to accept gets it. A provider with no matching skill is never asked.
    // A provider's own order goes to them alone: it is never offered to other providers.
    const ownProviderId = options.origin?.ownProviderId;
    let providerId = ownProviderId ?? data.providerId;
    let isOfferedToGroup = false;
    if (!providerId) {
      const customerRow = await this.prisma.customerProfile.findUnique({ where: { id: customerId }, select: { userId: true } });
      const eligibleIds = await this.dispatch.findEligibleProviderIds({ serviceId: data.serviceId, serviceIds: options.serviceIds, customerUserId: customerRow?.userId, location: serviceLocation });
      if (eligibleIds.length === 0) {
        throw new BadRequestException(
          serviceLocation
            ? 'No service provider covers this area for this service right now. Please try another area or try again shortly.'
            : 'No service provider offers this service right now. Please try again shortly.',
        );
      }
      // The order row needs a provider; this one only stands in until someone accepts and replaces it.
      providerId = eligibleIds[0];
      isOfferedToGroup = true;
    }

    // A provider named directly must be able to take work now. An order offered to a group only has a stand-in
    // here (it may owe a due: a negative wallet still gets offers), and the wallet is checked when someone accepts.
    if (!isOfferedToGroup) await assertProvider(this.prisma, providerId);
    await assertTechnician(this.prisma, data.technicianId);

    // A customer may run several orders of the same service at once; each order has its own
    // chat tab, assignee and lifecycle, so nothing here limits how many are active.

    // The provider's own commission percent. For an order offered to a group this is the stand-in's; it is
    // worked out again for whoever accepts (OrderDispatchService.closeOffersAfterAcceptance).
    // A provider's own order is charged by the admin's one rule for such orders (0 while it is off) instead.
    const commissionPercent = ownProviderId
      ? providerOrderChargePercent(await readProviderOrderCharge(this.prisma))
      : await providerCommissionPercent(this.prisma, providerId);
    const prices = { ...calculateOrderPrices({ ...data, commissionPercent }), commissionRate: commissionPercent };
    // The main service decides which chat the order is a tab of.
    const serviceRow = await this.prisma.service.findUnique({ where: { id: data.serviceId }, select: { categoryId: true } });

    const createdOrder = await createWithUniqueReference((referenceCode) =>
      this.prisma.order.create({
        data: {
          referenceCode,
          providerId,
          customerId,
          technicianId: data.technicianId,
          serviceId: data.serviceId,
          categoryId: serviceRow?.categoryId ?? null,
          isPricePending: options.isPricePending ?? false,
          createdByRole: options.origin?.createdByRole ?? (user && isOrderStaff(user.role) ? OrderCreator.ADMIN : OrderCreator.CUSTOMER),
          createdById: options.origin?.createdById ?? user?.id ?? null,
          // The provider made it, so it is theirs and taken from the start: nothing to accept. IN_PROGRESS, as a
          // provider's Accept sets it: extra charges, quotes and Work Complete all need it, and nothing moves an
          // order on from ACCEPTED.
          ...(ownProviderId ? { orderStatus: OrderStatus.IN_PROGRESS, acceptedAt: new Date() } : {}),
          ...prices,
        },
        include: ORDER_RELATIONS_INCLUDE,
      }),
    );

    if (isOfferedToGroup) await this.dispatch.dispatchNextWave(createdOrder.id, serviceLocation, options.serviceIds);
    return createdOrder;
  }


  findAll() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: ORDER_RELATIONS_INCLUDE,
    });
  }

  /**
   * The role comes from the signed-in account only. A number has exactly one role, so the old `x-active-role`
   * header added nothing but a hole: anyone could send PROVIDER and have a provider profile made for them.
   */
  async findAllForUser(user: { id: string; role: UserRole }) {
    const effectiveRole = user.role;

    if (effectiveRole === UserRole.PROVIDER) {
      let provider = await this.prisma.providerProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!provider) {
        provider = await this.prisma.providerProfile.create({
          data: { userId: user.id, isAvailable: true, isBlockedForNegative: false },
          select: { id: true },
        });
      }

      // What a provider sees: their own orders once they have taken them (a cancelled one only if they had),
      // plus new orders currently offered to them. A provider with no matching skill is never offered any,
      // so they see no new orders. Other providers' offers are never exposed.
      const now = new Date();
      const orders = await this.prisma.order.findMany({
        where: {
          OR: [
            { providerId: provider.id, orderStatus: { notIn: [OrderStatus.PENDING, OrderStatus.CANCELLED] } },
            { providerId: provider.id, orderStatus: OrderStatus.CANCELLED, acceptedAt: { not: null } },
            { orderStatus: OrderStatus.PENDING, offers: { some: { providerId: provider.id, status: 'OFFERED', expiresAt: { gt: now } } } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        include: { ...ORDER_RELATIONS_INCLUDE, offers: { where: { providerId: provider.id, status: 'OFFERED' }, select: { expiresAt: true } } },
      });
      // `myOfferExpiresAt`: when the offer on this order runs out, so the screen can count down.
      return orders.map(({ offers, ...order }) => ({ ...order, myOfferExpiresAt: order.orderStatus === OrderStatus.PENDING ? (offers[0]?.expiresAt ?? null) : null }));
    }

    if (effectiveRole === UserRole.TECHNICIAN) {
      const technician = await this.prisma.technicianProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!technician) return [];
      return this.prisma.order.findMany({
        where: { technicianId: technician.id },
        orderBy: { createdAt: 'desc' },
        include: ORDER_RELATIONS_INCLUDE,
      });
    }

    if (effectiveRole === UserRole.CUSTOMER) {
      const customer = await this.prisma.customerProfile.findUnique({
        where: { userId: user.id },
        select: { id: true },
      });
      if (!customer) return [];
      return this.findByCustomer(customer.id);
    }

    // Platform Staff (ADMIN, MANAGER, SUPPORT, HR) can oversee all orders
    return this.findAllForStaff();
  }

  /**
   * Every order for staff, and which pending ones need a person: nobody holds a live offer for them (everyone
   * asked said no or let it expire), so they would sit there for ever without an admin sending them on.
   */
  async findAllForStaff() {
    const orders = await this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        ...ORDER_RELATIONS_INCLUDE,
        offers: { where: { status: 'OFFERED', expiresAt: { gt: new Date() } }, select: { id: true }, take: 1 },
        _count: { select: { offers: true, expenseClaims: { where: { status: 'PENDING' } } } },
      },
    });
    return orders.map(({ offers, _count, ...order }) => ({
      ...order,
      needsAttention: order.orderStatus === OrderStatus.PENDING && offers.length === 0,
      offerCount: _count.offers,
      // The provider sent the job's costs and an admin has not reviewed them yet.
      hasPendingExpenseClaim: _count.expenseClaims > 0,
    }));
  }

  /** A provider reads only their own orders; staff read anyone's. Customers, technicians and other providers are turned away. */
  async findByProviderForUser(providerId: string, user: { id: string; role: UserRole }) {
    if (!isOrderStaff(user.role)) {
      const own = user.role === UserRole.PROVIDER ? await this.prisma.providerProfile.findUnique({ where: { userId: user.id }, select: { id: true } }) : null;
      if (own?.id !== providerId) throw new ForbiddenException('You can only see your own orders');
    }
    return this.findByProvider(providerId);
  }

  /** A customer reads only their own orders; staff read anyone's. */
  async findByCustomerForUser(customerId: string, user: { id: string; role: UserRole }) {
    if (!isOrderStaff(user.role)) {
      const own = user.role === UserRole.CUSTOMER ? await this.prisma.customerProfile.findUnique({ where: { userId: user.id }, select: { id: true } }) : null;
      if (own?.id !== customerId) throw new ForbiddenException('You can only see your own orders');
    }
    return this.findByCustomer(customerId);
  }

  findByProvider(providerId: string) {
    return this.prisma.order.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
      include: ORDER_RELATIONS_INCLUDE,
    });
  }

  findByCustomer(customerId: string) {
    return this.prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: ORDER_RELATIONS_INCLUDE,
    });
  }

  async findOne(id: string) {
    // Robust ID resolution: Try full UUID first, then look for short ID match
    let order = await this.prisma.order.findUnique({
      where: { id },
      include: ORDER_RELATIONS_INCLUDE,
    });

    if (!order && id.length === 8) {
      // If it looks like a short ID, try to find by prefix
      order = await this.prisma.order.findFirst({
        where: {
          id: {
            startsWith: id.toLowerCase(),
          },
        },
        include: ORDER_RELATIONS_INCLUDE,
      });
    }

    if (!order) {
      throw new NotFoundException(`Order with ID "${id}" not found`);
    }

    return order;
  }

  async findOneForUser(id: string, user: { id: string; role: UserRole }) {
    const order = await this.findOne(id);

    if (isOrderStaff(user.role)) return order;

    const isOwner = order.customer?.user?.id === user.id;
    const isAssignedProvider = order.provider?.user?.id === user.id;
    const isAssignedTech = order.technician?.user?.id === user.id;

    if (!isOwner && !isAssignedProvider && !isAssignedTech) {
      throw new ForbiddenException(
        'Access denied: You are not authorized to view or manage this order',
      );
    }

    return order;
  }

  async update(id: string, data: UpdateOrderDto, user: { id: string; role: UserRole }) {
    if (data.technicianId !== undefined) assertCanManageTechnicians(user.role);

    const order = await this.findOne(id);
    await assertTechnician(this.prisma, data.technicianId);

    const isPriceEdited =
      data.originalPrice !== undefined ||
      data.adminCommission !== undefined ||
      data.additionalPrice !== undefined;

    if (isPriceEdited && order.priceEditCount >= 2) {
      throw new BadRequestException(
        'Price can only be modified a maximum of 2 times!',
      );
    }

    const originalPrice = data.originalPrice ?? Number(order.originalPrice);
    const additionalPrice =
      data.additionalPrice ?? Number(order.additionalPrice);
    // A new price brings a new commission at the order's own percent; keeping the old amount would charge
    // the wrong share (and make expense approval work from it). An explicit adminCommission still wins.
    const isAmountChanged = data.originalPrice !== undefined || data.additionalPrice !== undefined;
    const adminCommission =
      data.adminCommission ??
      (isAmountChanged
        ? commissionFor(originalPrice + additionalPrice, order.commissionRate)
        : Number(order.adminCommission));
    const advancePaid = data.advancePaid ?? Number(order.advancePaid);

    const prices = calculateOrderPrices({
      originalPrice,
      adminCommission,
      additionalPrice,
      advancePaid,
    });

    return this.prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          technicianId: data.technicianId,
          orderStatus: data.orderStatus,
          // Completed once already (an order back from revision): the warranty keeps counting from then.
          ...(order.completedAt ? {} : completionStamp(data.orderStatus)),
          ...acceptanceStamp(order.orderStatus, data.orderStatus),
          paymentStatus: data.paymentStatus,
          ...prices,
          priceEditCount: isPriceEdited ? { increment: 1 } : undefined,
        },
        include: ORDER_RELATIONS_INCLUDE,
      });

      await handleCommissionBalance(tx, order, data.orderStatus);

      return updatedOrder;
    });
  }

  async updateStatus(id: string, data: UpdateOrderStatusDto) {
    const order = await this.findOne(id);

    return this.prisma.$transaction(async (tx) => {
      // PERMANENT FIX: If order is being completed, close all associated pending revisions
      if (data.orderStatus === 'COMPLETED') {
        await tx.serviceRevision.updateMany({
          where: {
            orderId: id,
            revisionStatus: { in: ['REQUESTED', 'ACCEPTED'] },
          },
          data: {
            revisionStatus: 'COMPLETED',
          },
        });
      }

      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          orderStatus: data.orderStatus,
          // Completed once already (an order back from revision): the warranty keeps counting from then.
          ...(order.completedAt ? {} : completionStamp(data.orderStatus)),
          ...acceptanceStamp(order.orderStatus, data.orderStatus),
        },
        include: ORDER_RELATIONS_INCLUDE,
      });

      await handleCommissionBalance(tx, order, data.orderStatus);

      return updatedOrder;
    });
  }

  async updateStatusForUser(
    id: string,
    data: UpdateOrderStatusDto,
    user: { id: string; role: UserRole },
  ) {
    const order = await this.findOne(id);

    // A provider taking a new order. Several providers were offered it, so the first to accept wins:
    // the claim only succeeds while the order is still PENDING, and everyone else's offer is withdrawn.
    if (
      user.role === UserRole.PROVIDER &&
      order.orderStatus === OrderStatus.PENDING &&
      (data.orderStatus === OrderStatus.IN_PROGRESS || data.orderStatus === OrderStatus.ACCEPTED)
    ) {
      const provider = await this.prisma.providerProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (!provider) throw new ForbiddenException('Provider profile not found');
      await assertProvider(this.prisma, provider.id);
      await this.dispatch.assertLiveOffer(id, provider.id);

      return this.prisma.$transaction(async (tx) => {
        const claimed = await tx.order.updateMany({
          where: { id, orderStatus: OrderStatus.PENDING },
          data: { providerId: provider.id, orderStatus: data.orderStatus, ...acceptanceStamp(order.orderStatus, data.orderStatus) },
        });
        if (claimed.count === 0) throw new ConflictException('Another provider has already accepted this order');

        await this.dispatch.closeOffersAfterAcceptance(tx, id, provider.id);
        return tx.order.findUniqueOrThrow({ where: { id }, include: ORDER_RELATIONS_INCLUDE });
      });
    }

    // Assert authorization before executing other status changes
    await this.findOneForUser(id, user);
    return this.updateStatus(id, data);
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.order.delete({
      where: { id },
    });

    return { message: 'Order deleted successfully' };
  }

  async acceptPrice(id: string) {
    const order = await this.findOne(id);
    await assertProvider(this.prisma, order.providerId);

    return this.prisma.order.update({
      where: { id },
      data: {
        orderStatus: 'IN_PROGRESS',
      },
      include: ORDER_RELATIONS_INCLUDE,
    });
  }

  async rejectPrice(id: string) {
    const order = await this.findOne(id);

    const originalPrice = Number(order.originalPrice);
    // The extra price is dropped, so is its commission: back to the order's percent of the original price.
    const adminCommission = commissionFor(originalPrice, order.commissionRate);
    const advancePaid = Number(order.advancePaid);

    const prices = calculateOrderPrices({
      originalPrice,
      adminCommission,
      additionalPrice: 0,
      advancePaid,
    });

    return this.prisma.order.update({
      where: { id },
      data: {
        ...prices,
      },
      include: ORDER_RELATIONS_INCLUDE,
    });
  }
}

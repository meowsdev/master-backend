import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OfferStatus, OrderStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderDispatchService } from '../order-dispatch/order-dispatch.service';
import { USER_EVENT_PUBLISHER } from '../order-dispatch/user-events';
import type { UserEventPublisher } from '../order-dispatch/user-events';
import { acceptanceStamp } from '../orders/order-view';
import { AssignmentMode } from './dto/assign-order.dto';

/** How long a provider has to answer an offer an admin sent personally. Longer than an automatic wave: someone chose them. */
const adminOfferMinutes = () => Number(process.env.ADMIN_OFFER_MINUTES) || 15;

interface ProviderRow {
  id: string;
  isAvailable: boolean;
  isBlockedForNegative: boolean;
  user: { id: string; status: UserStatus; isRestricted: boolean; serviceAssignments: Array<{ id: string }> };
}

/**
 * Staff send an order that no provider has taken to one chosen provider. The same rules as automatic dispatch
 * decide who may receive it (active, not restricted, not wallet-blocked, available, offers this service); only the
 * area check is left to the admin, who sees whether the provider covers the place and may send it anyway.
 */
@Injectable()
export class OrderAssignmentService {
  private readonly logger = new Logger(OrderAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatch: OrderDispatchService,
    @Inject(USER_EVENT_PUBLISHER) private readonly events: UserEventPublisher,
  ) {}

  /** Every provider with what stops them (if anything) and whether they cover this order's place. */
  async listAssignable(orderId: string) {
    const order = await this.loadOrder(this.prisma, orderId);
    if (order.orderStatus !== OrderStatus.PENDING) throw new ConflictException('This order is no longer waiting for a provider');

    const providers = await this.prisma.providerProfile.findMany({
      where: { user: { role: UserRole.PROVIDER } },
      select: {
        id: true,
        companyName: true,
        rating: true,
        isAvailable: true,
        isBlockedForNegative: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            mobileNumber: true,
            profilePhoto: true,
            status: true,
            isRestricted: true,
            serviceAssignments: { where: { serviceId: order.serviceId, isActive: true }, select: { id: true } },
          },
        },
        serviceAreas: { select: { districtId: true, upazilaId: true } },
        orderOffers: { where: { orderId }, select: { status: true } },
      },
    });

    const rows = providers.map(({ serviceAreas, orderOffers, rating, ...provider }) => {
      const blockedReason = this.blockedReason(provider, order.customerUserId);
      const location = order.location;
      return {
        ...provider,
        rating: Number(rating),
        blockedReason,
        canAssign: blockedReason === null,
        coversUpazila: Boolean(location && serviceAreas.some((area) => area.upazilaId === location.upazilaId)),
        coversDistrict: Boolean(location && serviceAreas.some((area) => area.districtId === location.districtId)),
        hasOpenOffer: orderOffers.some((offer) => offer.status === OfferStatus.OFFERED),
      };
    });

    // Those who can take it and cover the place first, then the rest by rating.
    const rank = (row: (typeof rows)[number]) => (row.canAssign ? 0 : 4) + (row.coversUpazila ? 0 : row.coversDistrict ? 1 : 2);
    return rows.sort((a, b) => rank(a) - rank(b) || b.rating - a.rating);
  }

  async assign(actor: { id: string }, orderId: string, providerProfileId: string, mode: AssignmentMode) {
    const result = await this.prisma.$transaction(async (tx) => {
      // The same lock automatic dispatch takes, so a wave and an admin cannot hand the order out at once.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`);
      const order = await this.loadOrder(tx, orderId);
      if (order.orderStatus !== OrderStatus.PENDING) throw new ConflictException('This order is no longer waiting for a provider');

      const provider = await tx.providerProfile.findUnique({
        where: { id: providerProfileId },
        select: {
          id: true,
          isAvailable: true,
          isBlockedForNegative: true,
          user: { select: { id: true, status: true, isRestricted: true, serviceAssignments: { where: { serviceId: order.serviceId, isActive: true }, select: { id: true } } } },
        },
      });
      if (!provider) throw new NotFoundException('Provider not found');
      const reason = this.blockedReason(provider, order.customerUserId);
      if (reason) throw new BadRequestException(`This provider cannot be given the order: ${reason}`);

      const expiresAt = new Date(Date.now() + adminOfferMinutes() * 60 * 1000);
      if (mode === 'OFFER') await this.offerToOne(tx, orderId, provider.id, expiresAt);
      else await this.giveToOne(tx, orderId, provider.id);

      await tx.orderAssignmentLog.create({ data: { orderId, actorId: actor.id, providerId: provider.id, mode } });
      return { providerUserId: provider.user.id, expiresAt, serviceName: order.serviceName, referenceCode: order.referenceCode };
    });

    this.notify(orderId, mode, result);
    return { orderId, providerId: providerProfileId, mode };
  }

  /** Only this provider holds an open offer; anyone else's is withdrawn. If they do not answer, automatic dispatch resumes. */
  private async offerToOne(tx: Prisma.TransactionClient, orderId: string, providerId: string, expiresAt: Date) {
    const now = new Date();
    await tx.orderOffer.updateMany({ where: { orderId, status: OfferStatus.OFFERED, providerId: { not: providerId } }, data: { status: OfferStatus.WITHDRAWN, respondedAt: now } });
    const latest = await tx.orderOffer.aggregate({ where: { orderId }, _max: { wave: true } });
    const wave = (latest._max.wave ?? 0) + 1;
    await tx.orderOffer.upsert({
      where: { orderId_providerId: { orderId, providerId } },
      update: { status: OfferStatus.OFFERED, expiresAt, wave, respondedAt: null },
      create: { orderId, providerId, wave, expiresAt },
    });
  }

  /** The order becomes this provider's and the work starts, exactly as when they accept it themselves; every other open offer is withdrawn. */
  private async giveToOne(tx: Prisma.TransactionClient, orderId: string, providerId: string) {
    await tx.order.update({
      where: { id: orderId },
      data: { providerId, orderStatus: OrderStatus.IN_PROGRESS, ...acceptanceStamp(OrderStatus.PENDING, OrderStatus.IN_PROGRESS) },
    });
    await this.dispatch.closeOffersAfterAcceptance(tx, orderId, providerId);
  }

  /** Same reasons automatic dispatch would skip a provider for. `null` means they may receive the order. */
  private blockedReason(provider: ProviderRow, customerUserId: string): string | null {
    if (provider.user.id === customerUserId) return 'This is the customer themselves';
    if (provider.user.status !== UserStatus.ACTIVE) return provider.user.status === UserStatus.BANNED ? 'Banned' : 'Blocked or inactive';
    if (provider.user.isRestricted) return 'Restricted from new orders';
    if (provider.isBlockedForNegative) return 'Wallet is negative';
    if (!provider.isAvailable) return 'Not available for orders';
    if (provider.user.serviceAssignments.length === 0) return 'Does not offer this service';
    return null;
  }

  private async loadOrder(client: Prisma.TransactionClient | PrismaService, orderId: string) {
    const order = await client.order.findUnique({
      where: { id: orderId },
      select: {
        referenceCode: true,
        orderStatus: true,
        serviceId: true,
        service: { select: { name: true } },
        customer: { select: { userId: true } },
        bookingDetail: { select: { districtId: true, upazilaId: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return {
      referenceCode: order.referenceCode,
      orderStatus: order.orderStatus,
      serviceId: order.serviceId,
      serviceName: order.service.name,
      customerUserId: order.customer.userId,
      location: order.bookingDetail,
    };
  }

  /** The provider's open app hears about it at once. A failure here never undoes the assignment. */
  private notify(orderId: string, mode: AssignmentMode, info: { providerUserId: string; expiresAt: Date; serviceName: string; referenceCode: string }) {
    try {
      const payload = { orderId, referenceCode: info.referenceCode, serviceName: info.serviceName };
      if (mode === 'OFFER') this.events.publishToUser(info.providerUserId, 'orderOffer', { ...payload, expiresAt: info.expiresAt.toISOString() });
      else this.events.publishToUser(info.providerUserId, 'orderAssigned', payload);
    } catch (error) {
      this.logger.warn(`Could not notify the provider about order ${orderId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

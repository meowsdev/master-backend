import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomOrderDto } from './dto/create-custom-order.dto';
import {
  UpdateOrderDto,
  UpdateOrderStatusDto,
} from './dto/update-order-status.dto';
import {
  ORDER_RELATIONS_INCLUDE,
  calculateOrderPrices,
  handleCommissionBalance,
  assertProvider,
  assertCustomer,
  assertService,
  assertTechnician,
} from './orders.helpers';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateCustomOrderDto, user?: { id: string; role: UserRole }) {
    await assertService(this.prisma, data.serviceId);

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

    // 2. Skill Match Engine: Find active provider who has selected this service skill
    let providerId = data.providerId;
    if (!providerId) {
      // Find active provider with this skill, prioritizing other providers over the current customer
      const assignee = await this.prisma.serviceAssignee.findFirst({
        where: {
          serviceId: data.serviceId,
          isActive: true,
          user: {
            role: UserRole.PROVIDER,
            status: 'ACTIVE',
            ...(user?.id ? { id: { not: user.id } } : {}),
            providerProfile: {
              isAvailable: true,
              isBlockedForNegative: false,
            },
          },
        },
        include: {
          user: {
            include: {
              providerProfile: true,
            },
          },
        },
      });

      if (assignee?.user?.providerProfile?.id) {
        providerId = assignee.user.providerProfile.id;
      } else {
        // Fallback: Pick any active, available provider with role PROVIDER
        const fallbackProvider = await this.prisma.providerProfile.findFirst({
          where: {
            isAvailable: true,
            isBlockedForNegative: false,
            user: {
              role: UserRole.PROVIDER,
              status: 'ACTIVE',
              ...(user?.id ? { id: { not: user.id } } : {}),
            },
          },
          select: { id: true },
        });

        if (fallbackProvider) {
          providerId = fallbackProvider.id;
        } else {
          // Final fallback to any active provider with role PROVIDER
          const anyProvider = await this.prisma.providerProfile.findFirst({
            where: {
              user: {
                role: UserRole.PROVIDER,
                status: 'ACTIVE',
              },
            },
            select: { id: true },
          });
          if (!anyProvider) {
            throw new BadRequestException(
              'Currently no service provider is available for this service. Please try again shortly.',
            );
          }
          providerId = anyProvider.id;
        }
      }
    }

    await assertProvider(this.prisma, providerId);
    await assertTechnician(this.prisma, data.technicianId);

    // Authoritative backend validation: Block duplicate active orders for the SAME service.
    // Different services can have concurrent active orders simultaneously.
    const existingActiveOrder = await this.prisma.order.findFirst({
      where: {
        customerId,
        serviceId: data.serviceId,
        orderStatus: {
          in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'],
        },
      },
      include: {
        service: true,
      },
    });

    if (existingActiveOrder) {
      const serviceName = existingActiveOrder.service?.name
        ? ` for "${existingActiveOrder.service.name}"`
        : '';
      throw new BadRequestException(
        `An active order (#${existingActiveOrder.id.slice(0, 8).toUpperCase()})${serviceName} is already running with status "${existingActiveOrder.orderStatus}". You cannot place another order for this same service until the current order is completed or cancelled.`,
      );
    }

    const prices = calculateOrderPrices(data);

    return this.prisma.order.create({
      data: {
        providerId,
        customerId,
        technicianId: data.technicianId,
        serviceId: data.serviceId,
        ...prices,
      },
      include: ORDER_RELATIONS_INCLUDE,
    });
  }


  findAll() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: ORDER_RELATIONS_INCLUDE,
    });
  }

  async findAllForUser(user: { id: string; role: UserRole }, activeRole?: UserRole) {
    const effectiveRole = activeRole || user.role;

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

      // Fetch active service skills for this provider
      const mySkills = await this.prisma.serviceAssignee.findMany({
        where: { userId: user.id, isActive: true },
        select: { serviceId: true },
      });
      const skillServiceIds = mySkills.map((s) => s.serviceId);

      // Strict Rule: If provider has 0 active skills, they receive ZERO pending job dispatches
      const whereConditions: any[] = [{ providerId: provider.id }];
      if (skillServiceIds.length > 0) {
        whereConditions.push({
          orderStatus: OrderStatus.PENDING,
          serviceId: { in: skillServiceIds },
        });
      }

      // Return assigned orders and open pending job dispatches strictly matching provider skills
      return this.prisma.order.findMany({
        where: {
          OR: whereConditions,
        },
        orderBy: { createdAt: 'desc' },
        include: ORDER_RELATIONS_INCLUDE,
      });
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
    return this.findAll();
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
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: ORDER_RELATIONS_INCLUDE,
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  async findOneForUser(id: string, user: { id: string; role: UserRole }) {
    const order = await this.findOne(id);

    if (
      user.role === UserRole.ADMIN ||
      user.role === UserRole.MANAGER ||
      user.role === UserRole.SUPPORT
    ) {
      return order;
    }

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

  async update(id: string, data: UpdateOrderDto) {
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
    const adminCommission =
      data.adminCommission ?? Number(order.adminCommission);
    const additionalPrice =
      data.additionalPrice ?? Number(order.additionalPrice);
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

    // If a provider is accepting/starting work on a PENDING job:
    if (
      (user.role === UserRole.PROVIDER || user.role === UserRole.TECHNICIAN) &&
      order.orderStatus === 'PENDING' &&
      (data.orderStatus === 'IN_PROGRESS' || data.orderStatus === 'ACCEPTED')
    ) {
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

      return this.prisma.$transaction(async (tx) => {
        const updatedOrder = await tx.order.update({
          where: { id },
          data: {
            providerId: provider.id,
            orderStatus: data.orderStatus,
          },
          include: ORDER_RELATIONS_INCLUDE,
        });

        await handleCommissionBalance(tx, order, data.orderStatus);
        return updatedOrder;
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
    const adminCommission = Number(order.adminCommission);
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

import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderStatus, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { USER_EVENT_PUBLISHER } from '../order-dispatch/user-events';
import type { UserEventPublisher } from '../order-dispatch/user-events';

/** A technician can only be put on an order that a provider has taken and that is not finished. */
const WORKABLE_STATUSES: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS];

interface Actor {
  id: string;
  role: UserRole;
}

/**
 * Which technician works on an order. The provider who owns the order chooses among THEIR OWN technicians
 * (those whose provider agency is this provider); an admin may do the same for any order. A technician of
 * another provider can never be put on someone else's order, whoever asks.
 */
@Injectable()
export class OrderTechnicianService {
  private readonly logger = new Logger(OrderTechnicianService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_EVENT_PUBLISHER) private readonly events: UserEventPublisher,
  ) {}

  /** The technicians that can be chosen for this order, with how many jobs each already has running. */
  async listForOrder(actor: Actor, orderId: string) {
    const order = await this.loadAuthorizedOrder(actor, orderId);
    const technicians = await this.prisma.technicianProfile.findMany({
      where: { providerAgencyId: order.providerId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        user: { select: { name: true, username: true, profilePhoto: true, status: true } },
        _count: { select: { orders: { where: { orderStatus: { in: WORKABLE_STATUSES } } } } },
      },
    });

    return {
      currentTechnicianId: order.technicianId,
      technicians: technicians.map(({ user, _count, ...technician }) => ({
        ...technician,
        name: user.name,
        username: user.username,
        profilePhoto: user.profilePhoto,
        // A blocked or banned technician cannot take work, so the screen greys them out.
        isActive: user.status === UserStatus.ACTIVE,
        activeJobs: _count.orders,
      })),
    };
  }

  async setTechnician(actor: Actor, orderId: string, technicianId: string | null) {
    const order = await this.loadAuthorizedOrder(actor, orderId);
    if (!WORKABLE_STATUSES.includes(order.orderStatus)) {
      throw new ConflictException('A technician can only be assigned while the order is accepted or in progress');
    }

    if (technicianId !== null) {
      const technician = await this.prisma.technicianProfile.findUnique({
        where: { id: technicianId },
        select: { id: true, providerAgencyId: true, user: { select: { status: true } } },
      });
      if (!technician) throw new NotFoundException('Technician not found');
      if (technician.providerAgencyId !== order.providerId) throw new BadRequestException('This technician does not work for the provider of this order');
      if (technician.user.status !== UserStatus.ACTIVE) throw new BadRequestException('This technician is blocked and cannot take work');
    }

    await this.prisma.order.update({ where: { id: orderId }, data: { technicianId } });
    await this.notifyTechnicians(orderId, order.technicianId, technicianId);
    return { orderId, technicianId };
  }

  /**
   * Tells the technicians' open apps at once: the new one gets `jobAssigned`, the one taken off (or replaced)
   * gets `jobUnassigned`. A failure here never undoes the change: their job list still picks it up on its
   * next refresh.
   */
  private async notifyTechnicians(orderId: string, previousId: string | null, nextId: string | null) {
    if (previousId === nextId) return;
    try {
      const ids = [previousId, nextId].filter((id): id is string => Boolean(id));
      const [order, technicians] = await Promise.all([
        this.prisma.order.findUnique({ where: { id: orderId }, select: { referenceCode: true, service: { select: { name: true } } } }),
        this.prisma.technicianProfile.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true } }),
      ]);
      const payload = { orderId, referenceCode: order?.referenceCode ?? null, serviceName: order?.service?.name ?? null };
      const userOf = (id: string | null) => technicians.find((technician) => technician.id === id)?.userId;

      const nextUserId = userOf(nextId);
      if (nextUserId) this.events.publishToUser(nextUserId, 'jobAssigned', payload);
      const previousUserId = userOf(previousId);
      if (previousUserId) this.events.publishToUser(previousUserId, 'jobUnassigned', payload);
    } catch (error) {
      this.logger.warn(`Could not notify technicians about order ${orderId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The order must exist and the actor must be its provider (or an admin). Everyone else is turned away. */
  private async loadAuthorizedOrder(actor: Actor, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, providerId: true, technicianId: true, orderStatus: true, provider: { select: { userId: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');

    const isAdmin = actor.role === UserRole.ADMIN;
    const isOwnerProvider = actor.role === UserRole.PROVIDER && order.provider.userId === actor.id;
    if (!isAdmin && !isOwnerProvider) throw new ForbiddenException('Only the provider of this order can choose its technician');
    return order;
  }
}

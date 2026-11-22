import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isOrderStaff } from '../auth/role-policy';
import {
  CreateServiceRevisionDto,
  UpdateServiceRevisionDto,
} from './dto/service-revision.dto';
import { REVISION_WINDOW_DAYS, hasOpenRevision, revisionDeadline } from './revision-window';

type Actor = { id: string; role: UserRole | string };

/** Who may send a completed order back for revision: its customer, or an admin. */
const canRequestRevision = (actor: Actor, order: { customer: { userId: string } }) =>
  actor.role === UserRole.ADMIN || order.customer.userId === actor.id;

@Injectable()
export class ServiceRevisionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sends a completed order back to its provider for a re-touch / re-work, inside the 7-day service
   * warranty. The order goes back to IN_PROGRESS so the provider works on it again; finishing it
   * (order-completion `finishRevision`) closes it without charging anything a second time.
   */
  async create(data: CreateServiceRevisionDto, actor: Actor) {
    const order = await this.prisma.order.findUnique({
      where: { id: data.orderId },
      select: {
        id: true,
        orderStatus: true,
        completedAt: true,
        customer: { select: { userId: true } },
        revisions: { select: { revisionStatus: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!canRequestRevision(actor, order)) {
      throw new ForbiddenException('Only the customer of this order or an admin can request a revision');
    }
    if (hasOpenRevision(order.revisions)) throw new ConflictException('This order is already in revision');
    if (order.orderStatus !== OrderStatus.COMPLETED) {
      throw new BadRequestException('Revisions can only be requested for completed orders');
    }

    const deadline = revisionDeadline(order);
    if (!deadline || Date.now() > deadline.getTime()) {
      throw new BadRequestException(`The ${REVISION_WINDOW_DAYS}-day service warranty for this order has ended`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Re-checked under the write: two taps (or the customer and an admin at once) open only one revision.
      const reopened = await tx.order.updateMany({
        where: { id: order.id, orderStatus: OrderStatus.COMPLETED },
        data: { orderStatus: OrderStatus.IN_PROGRESS },
      });
      if (reopened.count === 0) throw new ConflictException('This order is already in revision');

      return tx.serviceRevision.create({
        data: {
          orderId: order.id,
          issueDescription: data.issueDescription.trim(),
          attachedImages: data.attachedImages ?? [],
          revisionStatus: 'REQUESTED',
          warrantyExpiresAt: deadline,
        },
      });
    });
  }

  /** Every revision on the platform, newest first. Admin only (guarded in the controller). */
  findAll() {
    return this.prisma.serviceRevision.findMany({
      orderBy: { createdAt: 'desc' },
      include: { order: { select: { id: true, referenceCode: true, orderStatus: true } } },
    });
  }

  /** One order's revisions, for its customer, provider, technician or staff. */
  async findByOrder(orderId: string, actor: Actor) {
    await this.assertCanRead(orderId, actor);
    return this.prisma.serviceRevision.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, actor?: Actor) {
    const revision = await this.prisma.serviceRevision.findUnique({ where: { id } });
    if (!revision) throw new NotFoundException('Service revision not found');
    if (actor) await this.assertCanRead(revision.orderId, actor);
    return revision;
  }

  /** Admin only (guarded in the controller): correct the description or the status. */
  async update(id: string, data: UpdateServiceRevisionDto) {
    await this.findOne(id);
    return this.prisma.serviceRevision.update({ where: { id }, data });
  }

  /** Admin only (guarded in the controller). */
  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.serviceRevision.delete({ where: { id } });
    return { message: 'Service revision deleted successfully' };
  }

  /** The customer's answer after a revision: keep chatting with this provider, or not. */
  async postRevisionFeedback(id: string, continueWithProvider: boolean, actor: Actor) {
    const revision = await this.prisma.serviceRevision.findUnique({
      where: { id },
      include: { order: { select: { providerId: true, customerId: true, customer: { select: { userId: true } } } } },
    });
    if (!revision) throw new NotFoundException('Service revision not found');
    if (revision.order.customer.userId !== actor.id) {
      throw new ForbiddenException('Only the customer of this order can answer');
    }

    return this.prisma.$transaction(async (tx) => {
      const updateRevision = await tx.serviceRevision.update({
        where: { id },
        data: { revisionStatus: 'COMPLETED' },
      });
      if (!continueWithProvider) {
        await tx.activeChatSlot.updateMany({
          where: {
            providerId: revision.order.providerId,
            customerId: revision.order.customerId,
            status: { in: ['ACTIVE', 'PAUSED'] },
          },
          data: { status: 'CLOSED' },
        });

        await tx.customerRetention.updateMany({
          where: {
            providerId: revision.order.providerId,
            customerId: revision.order.customerId,
          },
          data: {
            isChatActive: false,
            removedReason: 'Customer opted out after service revision',
          },
        });
      }
      return {
        message: continueWithProvider
          ? 'Feedback submitted. You can continue chatting with this provider.'
          : 'Feedback submitted. Provider has been removed from your active chat.',
        revision: updateRevision,
      };
    });
  }

  /** The order's customer, provider, technician, or staff. */
  private async assertCanRead(orderId: string, actor: Actor) {
    if (isOrderStaff(actor.role)) return;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        customer: { select: { userId: true } },
        provider: { select: { userId: true } },
        technician: { select: { userId: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const parties = [order.customer.userId, order.provider.userId, order.technician?.userId];
    if (!parties.includes(actor.id)) throw new ForbiddenException('You are not part of this order');
  }
}

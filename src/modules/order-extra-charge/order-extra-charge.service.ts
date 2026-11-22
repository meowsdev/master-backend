import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ExtraChargeStatus, OrderStatus, Prisma, UserRole } from '@prisma/client';
import { assertNoPhoneNumber } from '../../common/contact-privacy';
import { COMMISSION_RATE } from '../orders/orders.helpers';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExtraChargeDto } from './dto/create-extra-charge.dto';
import { isOrderStaff } from '../auth/role-policy';
import { OPEN_REVISION_STATUSES } from '../service-revision/revision-window';

type Actor = { id: string; role: UserRole };
type Decision = 'APPROVED' | 'REJECTED';

/**
 * A customer who has never signed in to the app (an order an admin placed for them) cannot answer an extra
 * bill, so it is approved automatically after this many minutes; the provider explains it on site. Customers
 * who use the app always answer themselves. Overridable with EXTRA_CHARGE_AUTO_APPROVE_MINUTES.
 */
export const autoApproveMinutes = () => Number(process.env.EXTRA_CHARGE_AUTO_APPROVE_MINUTES) || 30;

/** Per the provider rules, the price may be changed at most twice per order. */
export const MAX_APPROVED_EXTRA_CHARGES = 2;

const ORDER_PARTIES_SELECT = {
  id: true,
  orderStatus: true,
  totalPrice: true,
  priceEditCount: true,
  // isVerified: false until the customer signs in to the app themselves.
  customer: { select: { userId: true, user: { select: { isVerified: true } } } },
  provider: { select: { userId: true } },
  technician: { select: { userId: true } },
} as const;

@Injectable()
export class OrderExtraChargeService {
  private readonly logger = new Logger(OrderExtraChargeService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async loadOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: ORDER_PARTIES_SELECT });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async request(orderId: string, dto: CreateExtraChargeDto, actor: Actor) {
    const order = await this.loadOrder(orderId);

    const isWorkingOnOrder = order.provider.userId === actor.id || order.technician?.userId === actor.id;
    if (!isWorkingOnOrder) throw new ForbiddenException('Only the provider handling this order can add extra charges');
    if (order.orderStatus !== OrderStatus.IN_PROGRESS) {
      throw new BadRequestException('Extra charges can only be added while the work is in progress');
    }
    // The warranty covers the service only. Parts or a bigger problem found during a revision are billed
    // as extra charges, and each revision gets its own price-change limit (the first job's edits do not count).
    const openRevision = await this.prisma.serviceRevision.findFirst({
      where: { orderId, revisionStatus: { in: [...OPEN_REVISION_STATUSES] } },
      select: { createdAt: true },
    });
    const priceEdits = openRevision
      ? await this.prisma.extraChargeRequest.count({
          where: { orderId, status: ExtraChargeStatus.APPROVED, createdAt: { gte: openRevision.createdAt } },
        })
      : order.priceEditCount;
    if (priceEdits >= MAX_APPROVED_EXTRA_CHARGES) {
      throw new BadRequestException(`The price can be changed at most ${MAX_APPROVED_EXTRA_CHARGES} times`);
    }

    const payment = await this.prisma.orderPaymentAndTip.findUnique({ where: { orderId }, select: { paymentMode: true } });
    if (payment?.paymentMode === 'ONLINE') throw new BadRequestException('The work is finished and waiting for payment');

    const pending = await this.prisma.extraChargeRequest.findFirst({ where: { orderId, status: ExtraChargeStatus.PENDING } });
    if (pending) throw new ConflictException('The customer has not answered your previous extra-charge request yet');

    // The customer reads these labels, so they cannot carry the provider's phone number.
    dto.items.forEach((item) => assertNoPhoneNumber(item.label));

    const items = dto.items.map(({ label, amount }) => ({ label: label.trim(), amount }));
    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

    const isCustomerOffApp = !order.customer.user.isVerified;
    return this.prisma.extraChargeRequest.create({
      data: {
        orderId,
        requestedById: actor.id,
        items,
        totalAmount,
        previousTotal: order.totalPrice,
        autoApproveAt: isCustomerOffApp ? new Date(Date.now() + autoApproveMinutes() * 60 * 1000) : null,
      },
    });
  }

  async list(orderId: string, actor: Actor) {
    const order = await this.loadOrder(orderId);
    // Reading is open to the order's parties and to staff; answering stays with the customer only.
    const isParty = [order.customer.userId, order.provider.userId, order.technician?.userId].includes(actor.id);
    if (!isParty && !isOrderStaff(actor.role)) throw new ForbiddenException('You are not part of this order');

    return this.prisma.extraChargeRequest.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  /** Only the order's customer answers. Approval and the price change happen in one transaction. */
  async respond(requestId: string, decision: Decision, actor: Actor) {
    const request = await this.prisma.extraChargeRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Extra-charge request not found');

    const order = await this.loadOrder(request.orderId);
    if (order.customer.userId !== actor.id) throw new ForbiddenException('Only the customer of this order can answer');
    if (order.orderStatus !== OrderStatus.IN_PROGRESS) throw new BadRequestException('This order is no longer in progress');

    return this.prisma.$transaction(async (tx) => {
      await this.applyDecision(tx, request, order.id, decision, false);
      return tx.extraChargeRequest.findUniqueOrThrow({ where: { id: requestId } });
    });
  }

  /**
   * Approves every extra bill whose auto-approve time has passed, while its customer still has not signed in
   * to the app and the work is still in progress. A customer who signed in meanwhile answers it themselves.
   * The scheduler calls this every minute. Returns how many were approved.
   */
  async autoApproveDue(now = new Date()): Promise<number> {
    const due = await this.prisma.extraChargeRequest.findMany({
      where: {
        status: ExtraChargeStatus.PENDING,
        autoApproveAt: { lte: now },
        order: { orderStatus: OrderStatus.IN_PROGRESS, customer: { user: { isVerified: false } } },
      },
      select: { id: true, orderId: true, totalAmount: true },
    });

    let approved = 0;
    for (const request of due) {
      try {
        await this.prisma.$transaction((tx) => this.applyDecision(tx, request, request.orderId, 'APPROVED', true));
        approved += 1;
      } catch (error) {
        // Answered a moment ago (by the customer or another tick): nothing to do.
        if (!(error instanceof ConflictException)) this.logger.warn(`Could not auto-approve extra charge ${request.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return approved;
  }

  /** Answers one PENDING request and, when approved, adds it to the bill. Approval and the price change happen together. */
  private async applyDecision(tx: Prisma.TransactionClient, request: { id: string; totalAmount: Prisma.Decimal | number }, orderId: string, decision: Decision, isAutomatic: boolean) {
    // updateMany with the PENDING guard makes a double tap (or two tabs, or the timer racing the customer) apply the charge once.
    const claimed = await tx.extraChargeRequest.updateMany({
      where: { id: request.id, status: ExtraChargeStatus.PENDING },
      data: { status: decision, respondedAt: new Date(), isAutoApproved: isAutomatic },
    });
    if (claimed.count === 0) throw new ConflictException('This request was already answered');

    if (decision === 'APPROVED') {
      await tx.order.update({
        where: { id: orderId },
        data: {
          // The platform's share grows with the job: approved extra work is commissioned like the rest.
          adminCommission: { increment: Math.round(Number(request.totalAmount) * COMMISSION_RATE) },
          additionalPrice: { increment: request.totalAmount },
          totalPrice: { increment: request.totalAmount },
          dueAmount: { increment: request.totalAmount },
          priceEditCount: { increment: 1 },
        },
      });
    }
  }
}

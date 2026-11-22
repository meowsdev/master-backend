import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfirmationStatus, ExtraChargeStatus, OrderStatus, PaymentMode, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { COMMISSION_RATE, handleCommissionBalance } from '../orders/orders.helpers';
import { completionStamp } from '../orders/order-view';
import { CompleteOrderDto, FinishRevisionDto, PayOnlineDto } from './dto/order-completion.dto';
import { PaymentGateway } from './payment-gateway';
import { OPEN_REVISION_STATUSES, hasOpenRevision } from '../service-revision/revision-window';

type Actor = { id: string; role: UserRole };
type Tx = Prisma.TransactionClient;

const ORDER_SELECT = {
  id: true,
  orderStatus: true,
  totalPrice: true,
  advancePaid: true,
  dueAmount: true,
  adminCommission: true,
  providerId: true,
  // Set once the order was first settled; a later settlement only pays for revision extras.
  completedAt: true,
  customer: { select: { userId: true } },
  provider: { select: { userId: true } },
  technician: { select: { userId: true } },
  paymentAndTip: true,
  revisions: { select: { revisionStatus: true, createdAt: true } },
} satisfies Prisma.OrderSelect;

@Injectable()
export class OrderCompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
  ) {}

  private async loadOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /** Provider (or the assigned technician) says the work is done and how the customer will pay. */
  async complete(orderId: string, dto: CompleteOrderDto, actor: Actor) {
    const order = await this.loadOrder(orderId);

    const isWorkingOnOrder = order.provider.userId === actor.id || order.technician?.userId === actor.id;
    if (!isWorkingOnOrder) throw new ForbiddenException('Only the provider handling this order can complete it');
    if (order.orderStatus !== OrderStatus.IN_PROGRESS) {
      throw new BadRequestException('Only an order that is in progress can be completed');
    }
    // A revision was already paid for: it is finished with finishRevision, never billed again.
    if (hasOpenRevision(order.revisions)) {
      throw new ConflictException('This order is in revision. Mark the revision as done instead.');
    }
    if (order.paymentAndTip?.paymentMode === PaymentMode.ONLINE) {
      throw new ConflictException('Already waiting for the customer to pay online');
    }

    if (dto.paymentMode === 'ONLINE') {
      if (dto.tipAmount) throw new BadRequestException('An online tip is paid by the customer in the app');
      return this.prisma.orderPaymentAndTip.upsert({
        where: { orderId },
        update: { paymentMode: PaymentMode.ONLINE, confirmationStatus: ConfirmationStatus.PENDING },
        create: { orderId, paymentMode: PaymentMode.ONLINE, confirmationStatus: ConfirmationStatus.PENDING },
      });
    }

    // Cash: the provider collected the due amount on site, so the order closes without the customer doing anything.
    return this.prisma.$transaction((tx) =>
      this.finishOrder(tx, order, { paymentMode: PaymentMode.CASH, tipAmount: dto.tipAmount ?? 0, deductCommission: true }),
    );
  }

  /**
   * Provider (or the assigned technician) says the revision (re-touch / re-work) is done, and writes why the
   * order came back (and whether the first job's quality caused it). The warranty covers the service only:
   * parts or a bigger problem found during the revision are billed as extra charges. So:
   * - nothing due: the order goes back to COMPLETED as it was, no new payment and no second commission;
   * - extra charges due, cash: collected on site, the order closes now (commission on the extras only);
   * - extra charges due, online: the customer gets "Accept & Pay"; the order closes when they pay.
   * The warranty still counts from the first completion.
   */
  async finishRevision(orderId: string, dto: FinishRevisionDto, actor: Actor) {
    const order = await this.loadOrder(orderId);

    const isWorkingOnOrder = order.provider.userId === actor.id || order.technician?.userId === actor.id;
    if (!isWorkingOnOrder) throw new ForbiddenException('Only the provider handling this order can finish its revision');
    if (order.orderStatus !== OrderStatus.IN_PROGRESS || !hasOpenRevision(order.revisions)) {
      throw new BadRequestException('This order has no revision in progress');
    }
    if (order.paymentAndTip?.paymentMode === PaymentMode.ONLINE) {
      throw new ConflictException('Already waiting for the customer to pay online');
    }
    // Finishing would leave the customer's answer stuck: the order would no longer be in progress.
    const pendingCharge = await this.prisma.extraChargeRequest.count({ where: { orderId, status: ExtraChargeStatus.PENDING } });
    if (pendingCharge > 0) throw new ConflictException('The customer has not answered your extra-charge request yet');

    const isMoneyDue = Number(order.dueAmount) > 0;
    if (isMoneyDue && !dto.paymentMode) {
      throw new BadRequestException('Extra charges were added during this revision; choose how the customer pays');
    }

    const record = { completionReason: dto.reason.trim(), wasQualityIssue: dto.wasQualityIssue };
    const openRevisions = { orderId, revisionStatus: { in: [...OPEN_REVISION_STATUSES] } };

    if (isMoneyDue && dto.paymentMode === 'ONLINE') {
      // The reason is kept now; the revision closes when the customer pays (payOnline → finishOrder).
      return this.prisma.$transaction(async (tx) => {
        await tx.serviceRevision.updateMany({ where: openRevisions, data: record });
        await tx.orderPaymentAndTip.update({
          where: { orderId },
          data: { paymentMode: PaymentMode.ONLINE, confirmationStatus: ConfirmationStatus.PENDING },
        });
        return { id: orderId, orderStatus: OrderStatus.IN_PROGRESS };
      });
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.serviceRevision.updateMany({ where: openRevisions, data: record });
      if (isMoneyDue) {
        // Cash for the extras, collected on site.
        await this.finishOrder(tx, order, { paymentMode: PaymentMode.CASH, tipAmount: 0, deductCommission: true });
      } else {
        await tx.serviceRevision.updateMany({ where: openRevisions, data: { revisionStatus: 'COMPLETED', completedAt: new Date() } });
        await tx.order.update({ where: { id: orderId }, data: { orderStatus: OrderStatus.COMPLETED } });
      }
      return { id: orderId, orderStatus: OrderStatus.COMPLETED };
    });
  }

  /** The customer's "Accept & Pay": charge the due amount plus tip, then complete the order. */
  async payOnline(orderId: string, dto: PayOnlineDto, actor: Actor) {
    const order = await this.loadOrder(orderId);

    if (order.customer.userId !== actor.id) throw new ForbiddenException('Only the customer of this order can pay');
    const awaitingPayment = order.paymentAndTip?.paymentMode === PaymentMode.ONLINE;
    if (order.orderStatus !== OrderStatus.IN_PROGRESS || !awaitingPayment) {
      throw new BadRequestException('This order is not waiting for an online payment');
    }

    const tipAmount = dto.tipAmount ?? 0;
    const amount = Number(order.dueAmount) + tipAmount;
    const result = await this.gateway.charge({ method: dto.method, amount, orderId });
    if (!result.success) throw new BadRequestException('The payment was not completed');

    return this.prisma.$transaction(async (tx) => {
      // Claiming the PENDING payment first makes a double tap charge and complete only once.
      const claimed = await tx.orderPaymentAndTip.updateMany({
        where: { orderId, paymentMode: PaymentMode.ONLINE, confirmationStatus: ConfirmationStatus.PENDING },
        data: { confirmationStatus: ConfirmationStatus.CONFIRMED },
      });
      if (claimed.count === 0) throw new ConflictException('This payment was already made');

      return this.finishOrder(tx, order, { paymentMode: dto.method, tipAmount, deductCommission: false });
    });
  }

  /**
   * Settle the bill in full and close the order.
   * Platform commission leaves the provider's wallet only for cash (COD); online money reaches the
   * platform first, so only the completed-orders counter moves.
   */
  private async finishOrder(
    tx: Tx,
    order: Awaited<ReturnType<OrderCompletionService['loadOrder']>>,
    settlement: { paymentMode: PaymentMode; tipAmount: number; deductCommission: boolean },
  ) {
    const totalPrice = Number(order.totalPrice);
    // Settled once already: this pays only the extra charges added during a revision. The first
    // settlement's commission, completed-orders count, tip and completion time all stay as they were.
    const isRevisionSettlement = Boolean(order.completedAt);
    const tipTotal = (isRevisionSettlement ? Number(order.paymentAndTip?.tipAmount ?? 0) : 0) + settlement.tipAmount;

    if (isRevisionSettlement && settlement.deductCommission) await this.deductRevisionCommission(tx, order);

    await tx.serviceRevision.updateMany({
      where: { orderId: order.id, revisionStatus: { in: [...OPEN_REVISION_STATUSES] } },
      data: { revisionStatus: 'COMPLETED', completedAt: new Date() },
    });

    const payment = await tx.orderPaymentAndTip.upsert({
      where: { orderId: order.id },
      update: {
        paymentMode: settlement.paymentMode,
        serviceAmountPaid: totalPrice,
        tipAmount: tipTotal,
        hasTip: tipTotal > 0,
        confirmationStatus: ConfirmationStatus.CONFIRMED,
        customerConfirmedAt: settlement.deductCommission ? null : new Date(),
      },
      create: {
        orderId: order.id,
        paymentMode: settlement.paymentMode,
        serviceAmountPaid: totalPrice,
        tipAmount: settlement.tipAmount,
        hasTip: settlement.tipAmount > 0,
        confirmationStatus: ConfirmationStatus.CONFIRMED,
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        orderStatus: OrderStatus.COMPLETED,
        // The 7-day warranty counts from the first completion, never from a revision.
        ...(isRevisionSettlement ? {} : completionStamp(OrderStatus.COMPLETED)),
        advancePaid: totalPrice,
        dueAmount: 0,
        paymentStatus: PaymentStatus.PAID,
      },
    });

    const commissionOrder = settlement.deductCommission ? order : { ...order, adminCommission: 0 };
    // Returns at once for a revision settlement (completedAt is set): that commission was handled above.
    await handleCommissionBalance(tx, commissionOrder, OrderStatus.COMPLETED);

    return payment;
  }

  /**
   * Cash for extra charges added during a revision: the platform's share of those extras only (the same
   * share applyDecision added to adminCommission) leaves the provider's wallet. The first job's commission
   * was taken at the first completion.
   */
  private async deductRevisionCommission(tx: Tx, order: Awaited<ReturnType<OrderCompletionService['loadOrder']>>) {
    const revision = order.revisions.find((item) => (OPEN_REVISION_STATUSES as readonly string[]).includes(item.revisionStatus));
    if (!revision) return;

    const extras = await tx.extraChargeRequest.findMany({
      where: { orderId: order.id, status: ExtraChargeStatus.APPROVED, createdAt: { gte: revision.createdAt } },
      select: { totalAmount: true },
    });
    const commission = extras.reduce((sum, extra) => sum + Math.round(Number(extra.totalAmount) * COMMISSION_RATE), 0);
    if (commission <= 0) return;

    const provider = await tx.providerProfile.findUnique({ where: { id: order.providerId }, select: { walletBalance: true } });
    if (!provider) return;
    const newBalance = Number(provider.walletBalance) - commission;
    await tx.providerProfile.update({
      where: { id: order.providerId },
      data: { walletBalance: newBalance, isAvailable: newBalance >= 0, isBlockedForNegative: newBalance < 0 },
    });
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfirmationStatus, OrderStatus, PaymentMode, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { handleCommissionBalance } from '../orders/orders.helpers';
import { completionStamp } from '../orders/order-view';
import { CompleteOrderDto, PayOnlineDto } from './dto/order-completion.dto';
import { PaymentGateway } from './payment-gateway';
import { hasOpenRevision } from '../service-revision/revision-window';

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
  customer: { select: { userId: true } },
  provider: { select: { userId: true } },
  technician: { select: { userId: true } },
  paymentAndTip: true,
  revisions: { select: { revisionStatus: true } },
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
   * Provider (or the assigned technician) says the revision (re-touch / re-work) is done. The order goes
   * back to COMPLETED as it was: no new payment, no second commission, and the warranty still counts from
   * the first completion.
   */
  async finishRevision(orderId: string, actor: Actor) {
    const order = await this.loadOrder(orderId);

    const isWorkingOnOrder = order.provider.userId === actor.id || order.technician?.userId === actor.id;
    if (!isWorkingOnOrder) throw new ForbiddenException('Only the provider handling this order can finish its revision');
    if (order.orderStatus !== OrderStatus.IN_PROGRESS || !hasOpenRevision(order.revisions)) {
      throw new BadRequestException('This order has no revision in progress');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.serviceRevision.updateMany({
        where: { orderId, revisionStatus: { in: ['REQUESTED', 'ACCEPTED'] } },
        data: { revisionStatus: 'COMPLETED' },
      });
      return tx.order.update({ where: { id: orderId }, data: { orderStatus: OrderStatus.COMPLETED }, select: { id: true, orderStatus: true } });
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

    await tx.serviceRevision.updateMany({
      where: { orderId: order.id, revisionStatus: { in: ['REQUESTED', 'ACCEPTED'] } },
      data: { revisionStatus: 'COMPLETED' },
    });

    const payment = await tx.orderPaymentAndTip.upsert({
      where: { orderId: order.id },
      update: {
        paymentMode: settlement.paymentMode,
        serviceAmountPaid: totalPrice,
        tipAmount: settlement.tipAmount,
        hasTip: settlement.tipAmount > 0,
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
        ...completionStamp(OrderStatus.COMPLETED),
        advancePaid: totalPrice,
        dueAmount: 0,
        paymentStatus: PaymentStatus.PAID,
      },
    });

    const commissionOrder = settlement.deductCommission ? order : { ...order, adminCommission: 0 };
    await handleCommissionBalance(tx, commissionOrder, OrderStatus.COMPLETED);

    return payment;
  }
}

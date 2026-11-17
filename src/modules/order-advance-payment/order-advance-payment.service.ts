import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentMode, PaymentStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGateway } from '../order-completion/payment-gateway';
import { PayAdvanceDto } from './dto/pay-advance.dto';

/** An advance makes sense once a provider took the job and until it is settled. */
const ADVANCE_STATUSES: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS];

@Injectable()
export class OrderAdvancePaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
  ) {}

  /**
   * The customer pays part of the bill early, before the work starts or in the middle of it.
   * It lowers the order's due, so the final payment asks only for what is left.
   */
  async pay(orderId: string, dto: PayAdvanceDto, actor: { id: string; role: UserRole }) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderStatus: true, totalPrice: true, dueAmount: true, advancePaid: true, customer: { select: { userId: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.customer.userId !== actor.id) throw new ForbiddenException('Only the customer of this order can pay');
    if (!ADVANCE_STATUSES.includes(order.orderStatus)) {
      throw new BadRequestException('An advance can be paid once a provider has accepted the order and before it is completed');
    }

    const due = Number(order.dueAmount);
    if (dto.amount > due) throw new BadRequestException(`The amount cannot be more than what is due (${due})`);

    const result = await this.gateway.charge({ method: dto.method, amount: dto.amount, orderId });
    if (!result.success) throw new BadRequestException('The payment was not completed');

    const remaining = Number((due - dto.amount).toFixed(2));
    return this.prisma.$transaction(async (tx) => {
      // Matching the due we read makes two simultaneous payments (or a payment during completion) conflict
      // instead of both succeeding against the same balance.
      const updated = await tx.order.updateMany({
        where: { id: orderId, dueAmount: order.dueAmount, orderStatus: { in: ADVANCE_STATUSES } },
        data: {
          advancePaid: { increment: dto.amount },
          dueAmount: remaining,
          paymentStatus: remaining === 0 ? PaymentStatus.PAID : PaymentStatus.PARTIAL,
        },
      });
      if (updated.count === 0) throw new ConflictException('The order changed while paying. Please check the amount and try again.');

      await tx.orderAdvancePayment.create({
        data: { orderId, amount: dto.amount, method: dto.method as PaymentMode, transactionId: result.transactionId, totalAtPayment: order.totalPrice, dueAfter: remaining },
      });
      return { advancePaid: Number(order.advancePaid) + dto.amount, dueAmount: remaining };
    });
  }
}

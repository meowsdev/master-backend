import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, QuoteStatus, UserRole } from '@prisma/client';
import { assertNoPhoneNumber } from '../../common/contact-privacy';
import { isOrderStaff } from '../auth/role-policy';
import { DEFAULT_COMMISSION_PERCENT, commissionFor } from '../orders/orders.helpers';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderQuoteDto } from './dto/create-order-quote.dto';

type Actor = { id: string; role: UserRole };

/** How many quotes a provider may send for one custom order (each new one replaces the unanswered one). */
export const maxQuotesPerOrder = () =>
  Number(process.env.ORDER_QUOTE_MAX_PER_ORDER) || 3;

/** The provider can price the job once they have taken it: after the visit, before or during the work. */
const QUOTABLE_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.IN_PROGRESS,
];

const ORDER_SELECT = {
  id: true,
  orderStatus: true,
  isPricePending: true,
  advancePaid: true,
  commissionRate: true,
  customer: { select: { userId: true } },
  provider: { select: { userId: true } },
  technician: { select: { userId: true } },
} as const;

/**
 * A customer's custom order has no price when it is placed (the visit is free). The provider visits, sends a
 * quote, and the customer accepts it (the quote becomes the order's price and the work can go on) or rejects
 * it (the order is cancelled with nothing to pay).
 */
@Injectable()
export class OrderQuoteService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: ORDER_SELECT,
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async send(orderId: string, dto: CreateOrderQuoteDto, actor: Actor) {
    const order = await this.loadOrder(orderId);
    const isWorkingOnOrder =
      order.provider.userId === actor.id ||
      order.technician?.userId === actor.id;
    if (!isWorkingOnOrder)
      throw new ForbiddenException(
        'Only the provider handling this order can send a price',
      );
    if (!order.isPricePending)
      throw new BadRequestException('This order already has a price');
    if (!QUOTABLE_STATUSES.includes(order.orderStatus))
      throw new BadRequestException('Accept the order before sending a price');

    const sent = await this.prisma.orderQuote.count({ where: { orderId } });
    if (sent >= maxQuotesPerOrder())
      throw new BadRequestException(
        `A price can be sent at most ${maxQuotesPerOrder()} times`,
      );

    // The customer reads these, so they cannot carry the provider's phone number.
    dto.items.forEach((item) => assertNoPhoneNumber(item.label));
    assertNoPhoneNumber(dto.note);

    const items = dto.items.map(({ label, amount }) => ({
      label: label.trim(),
      amount,
    }));
    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

    return this.prisma.$transaction(async (tx) => {
      // A newer price replaces one the customer has not answered yet.
      await tx.orderQuote.updateMany({
        where: { orderId, status: QuoteStatus.PENDING },
        data: { status: QuoteStatus.REPLACED, respondedAt: new Date() },
      });
      return tx.orderQuote.create({
        data: {
          orderId,
          requestedById: actor.id,
          items,
          totalAmount,
          note: dto.note?.trim() || null,
        },
      });
    });
  }

  async list(orderId: string, actor: Actor) {
    const order = await this.loadOrder(orderId);
    const isParty = [
      order.customer.userId,
      order.provider.userId,
      order.technician?.userId,
    ].includes(actor.id);
    if (!isParty && !isOrderStaff(actor.role))
      throw new ForbiddenException('You are not part of this order');
    return this.prisma.orderQuote.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Only the order's customer answers. Accepting prices the order; rejecting cancels it. Both happen in one transaction. */
  async respond(
    quoteId: string,
    decision: 'ACCEPTED' | 'REJECTED',
    actor: Actor,
  ) {
    const quote = await this.prisma.orderQuote.findUnique({
      where: { id: quoteId },
    });
    if (!quote) throw new NotFoundException('Price not found');
    const order = await this.loadOrder(quote.orderId);
    if (order.customer.userId !== actor.id)
      throw new ForbiddenException(
        'Only the customer of this order can answer',
      );
    if (!QUOTABLE_STATUSES.includes(order.orderStatus))
      throw new BadRequestException('This order is no longer open');

    return this.prisma.$transaction(async (tx) => {
      // The PENDING guard makes a double tap (or two tabs) apply the answer once.
      const claimed = await tx.orderQuote.updateMany({
        where: { id: quoteId, status: QuoteStatus.PENDING },
        data: { status: decision, respondedAt: new Date() },
      });
      if (claimed.count === 0)
        throw new ConflictException(
          'This price was already answered or replaced',
        );

      if (decision === 'ACCEPTED') {
        await tx.order.update({
          where: { id: order.id },
          data: acceptedQuotePrices(
            Number(quote.totalAmount),
            Number(order.advancePaid),
            Number(order.commissionRate),
          ),
        });
      } else {
        await tx.order.update({
          where: { id: order.id },
          data: { orderStatus: OrderStatus.CANCELLED },
        });
      }
      return tx.orderQuote.findUniqueOrThrow({ where: { id: quoteId } });
    });
  }
}

/** The order's price fields once the customer accepts a quote. The platform's share uses the order's commission percent. */
export function acceptedQuotePrices(
  total: number,
  advancePaid: number,
  commissionPercent: number = DEFAULT_COMMISSION_PERCENT,
): Prisma.OrderUpdateInput {
  return {
    isPricePending: false,
    originalPrice: total,
    totalPrice: total,
    adminCommission: commissionFor(total, commissionPercent),
    dueAmount: Math.max(0, total - advancePaid),
  };
}

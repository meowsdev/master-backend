import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { assertNoPhoneNumber } from '../../common/contact-privacy';
import { PrismaService } from '../../prisma/prisma.service';
import { RateCustomerDto } from './dto/rate-customer.dto';

@Injectable()
export class CustomerRatingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Only the provider (or technician) who handled the order may read or write its customer rating. */
  private async loadOrderForHandler(orderId: string, actorId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderStatus: true,
        customerId: true,
        provider: { select: { userId: true } },
        technician: { select: { userId: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const isHandler = order.provider.userId === actorId || order.technician?.userId === actorId;
    if (!isHandler) throw new ForbiddenException('Only the provider handling this order can rate its customer');
    return order;
  }

  /**
   * The provider side rates the customer once per order: whoever of the provider and the technician goes first.
   * The other one sees it already done, and by whom.
   */
  async find(orderId: string, actorId: string) {
    await this.loadOrderForHandler(orderId, actorId);
    const rating = await this.prisma.customerRating.findUnique({ where: { orderId } });
    if (!rating) return null;
    const rater = await this.prisma.user.findUnique({ where: { id: rating.ratedById }, select: { name: true, username: true, role: true } });
    return {
      ...rating,
      ratedBy: { name: rater?.name ?? (rater?.username ? `@${rater.username}` : null), role: rater?.role ?? null, isMe: rating.ratedById === actorId },
    };
  }

  async rate(orderId: string, dto: RateCustomerDto, actorId: string) {
    const order = await this.loadOrderForHandler(orderId, actorId);
    if (order.orderStatus !== OrderStatus.COMPLETED) {
      throw new BadRequestException('A customer can be rated once the order is completed');
    }
    // The customer and staff both see this text on the order, so the same no-phone-number rule applies.
    assertNoPhoneNumber(dto.comment);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.customerRating.create({
          data: { orderId, customerId: order.customerId, ratedById: actorId, rating: dto.rating, comment: dto.comment?.trim() || null },
        });
        const { _avg } = await tx.customerRating.aggregate({ where: { customerId: order.customerId }, _avg: { rating: true } });
        await tx.customerProfile.update({
          where: { id: order.customerId },
          data: { rating: Number((_avg.rating ?? dto.rating).toFixed(2)) },
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // The provider and the technician share one rating per order: the other one may have sent it first.
        throw new ConflictException('This customer was already rated for this order');
      }
      throw error;
    }
  }
}

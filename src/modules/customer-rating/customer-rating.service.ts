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

  async find(orderId: string, actorId: string) {
    await this.loadOrderForHandler(orderId, actorId);
    return this.prisma.customerRating.findUnique({ where: { orderId } });
  }

  async rate(orderId: string, dto: RateCustomerDto, actorId: string) {
    const order = await this.loadOrderForHandler(orderId, actorId);
    if (order.orderStatus !== OrderStatus.COMPLETED) {
      throw new BadRequestException('A customer can be rated once the order is completed');
    }
    // The customer never sees this text, but staff do; the same no-phone-number rule applies everywhere.
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
        throw new ConflictException('You already rated this customer');
      }
      throw error;
    }
  }
}

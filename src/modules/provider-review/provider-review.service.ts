import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateProviderReviewDto,
  UpdateProviderReviewDto,
} from './dto/provider-review.dto';
import { ratingsFromProviders, reviewsFromCustomers } from './received-reviews';

@Injectable()
export class ProviderReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateProviderReviewDto, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: data.orderId },
    });
    if (!order) throw new BadRequestException('Order not found');

    // Only the order's own customer reviews it, and only once the work is done.
    if (userId) {
      const orderCustomer = await this.prisma.customerProfile.findUnique({ where: { id: order.customerId }, select: { userId: true } });
      if (orderCustomer?.userId !== userId) throw new ForbiddenException('Only the customer of this order can review it');
    }
    if (order.orderStatus !== 'COMPLETED') throw new BadRequestException('An order can be reviewed after it is completed');

    const providerId = data.providerId || order.providerId;
    let customerId = data.customerId || order.customerId;

    if (!customerId && userId) {
      const customer = await this.prisma.customerProfile.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (customer) {
        customerId = customer.id;
      }
    }

    if (!providerId) {
      throw new BadRequestException('Provider ID is required');
    }
    if (!customerId) {
      throw new BadRequestException('Customer ID is required');
    }

    await this.assertProvider(providerId);
    await this.assertCustomer(customerId);

    const isPositive = data.customerRating >= 4;
    // Every review is public as soon as it is given, whatever the stars; an admin can hide one (setVisibility).
    const isPublic = true;
    const moderationStatus = 'APPROVED';
    const continueWithProvider = isPositive
      ? (data.continueWithProvider ?? true)
      : false;

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.providerReview.upsert({
        where: { orderId: data.orderId },
        update: {
          customerRating: data.customerRating,
          providerRating: data.providerRating,
          reviewComment: data.reviewComment,
          providerId,
          customerId,
          isPublic,
          moderationStatus,
          continueWithProvider,
        },
        create: {
          orderId: data.orderId,
          providerId,
          customerId,
          customerRating: data.customerRating,
          providerRating: data.providerRating,
          reviewComment: data.reviewComment,
          isPublic,
          moderationStatus,
          continueWithProvider,
        },
        include: this.includeRelations(),
      });

      if (!isPositive) {
        await tx.activeChatSlot.updateMany({
          where: {
            providerId,
            customerId,
            status: { in: ['ACTIVE', 'PAUSED'] },
          },
          data: {
            status: 'CLOSED',
          },
        });

        await tx.customerRetention.updateMany({
          where: {
            providerId,
            customerId,
          },
          data: {
            isChatActive: false,
            removedReason: 'Auto-removed due to negative review (Rating <= 3)',
          },
        });
      }
      // The provider's average follows every public review, low ones included.
      await this.recomputeRating(tx, providerId);
      return review;
    });
  }

  /** The provider's stored rating: the average of their public, approved reviews (unchanged when none). */
  private async recomputeRating(tx: Prisma.TransactionClient, providerId: string) {
    const agg = await tx.providerReview.aggregate({
      where: { providerId, isPublic: true, moderationStatus: 'APPROVED', status: 'ACTIVE' },
      _avg: { customerRating: true },
    });
    if (agg._avg.customerRating !== null) {
      await tx.providerProfile.update({ where: { id: providerId }, data: { rating: Number(agg._avg.customerRating.toFixed(2)) } });
    }
  }

  /**
   * Admin: show or hide one review everywhere customers see reviews (service pages, the provider's rating). Hiding
   * takes it out of the provider's average; showing it again puts it back.
   */
  async setVisibility(id: string, isPublic: boolean) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.providerReview.update({
        where: { id },
        data: { isPublic, ...(isPublic ? { moderationStatus: 'APPROVED' as const } : {}) },
        select: { id: true, isPublic: true, providerId: true },
      });
      await this.recomputeRating(tx, review.providerId);
      return { id: review.id, isPublic: review.isPublic };
    });
  }

  /**
   * The signed-in person's own reviews for their profile: the average shown next to their name and the latest
   * reviews with who wrote them. A customer gets what providers said about them; a provider or technician gets
   * what customers said about their orders.
   */
  async receivedBy(user: { id: string; role: string }) {
    const empty = { rating: 0, count: 0, reviews: [], completedOrders: 0, totalAmount: 0 };

    if (user.role === UserRole.CUSTOMER) {
      const profile = await this.prisma.customerProfile.findUnique({ where: { userId: user.id }, select: { id: true, rating: true } });
      if (!profile) return empty;
      const [count, reviews, orders] = await Promise.all([
        this.prisma.customerRating.count({ where: { customerId: profile.id } }),
        ratingsFromProviders(this.prisma, { customerId: profile.id }),
        this.completedTotals({ customerId: profile.id }),
      ]);
      // A customer's amount is what they spent: the full bill of every completed order.
      return { rating: Number(profile.rating), count, reviews, completedOrders: orders.count, totalAmount: orders.billed };
    }

    if (user.role === UserRole.PROVIDER) {
      const profile = await this.prisma.providerProfile.findUnique({ where: { userId: user.id }, select: { id: true, rating: true } });
      if (!profile) return empty;
      const [count, reviews, orders] = await Promise.all([
        this.prisma.providerReview.count({ where: { providerId: profile.id } }),
        reviewsFromCustomers(this.prisma, { providerId: profile.id }),
        this.completedTotals({ providerId: profile.id }),
      ]);
      // A provider's amount is their income: the bills minus the platform's commission.
      return { rating: Number(profile.rating), count, reviews, completedOrders: orders.count, totalAmount: orders.billed - orders.commission };
    }

    if (user.role === UserRole.TECHNICIAN) {
      // A technician has no stored average, so it is worked out from the reviews of the orders they did.
      const where = { order: { technician: { userId: user.id } } };
      const [summary, reviews, orders] = await Promise.all([
        this.prisma.providerReview.aggregate({ where, _avg: { customerRating: true }, _count: true }),
        reviewsFromCustomers(this.prisma, where),
        this.completedTotals({ technician: { userId: user.id } }),
      ]);
      return {
        rating: Number((summary._avg.customerRating ?? 0).toFixed(2)),
        count: summary._count,
        reviews,
        completedOrders: orders.count,
        // The work they did, after the platform's commission (the provider pays the technician from it).
        totalAmount: orders.billed - orders.commission,
      };
    }

    throw new ForbiddenException('Only customers, providers and technicians have reviews');
  }

  /** How many matching orders were completed, their bills added up, and the platform's commission on them. */
  private async completedTotals(where: Prisma.OrderWhereInput) {
    const result = await this.prisma.order.aggregate({
      where: { ...where, orderStatus: OrderStatus.COMPLETED },
      _count: true,
      _sum: { totalPrice: true, adminCommission: true },
    });
    return {
      count: result._count,
      billed: Number(result._sum.totalPrice ?? 0),
      commission: Number(result._sum.adminCommission ?? 0),
    };
  }

  findAll() {
    return this.prisma.providerReview.findMany({
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  findByProvider(providerId: string) {
    return this.prisma.providerReview.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  findByCustomer(customerId: string) {
    return this.prisma.providerReview.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  async findOne(id: string) {
    const review = await this.prisma.providerReview.findUnique({
      where: { id },
      include: this.includeRelations(),
    });
    if (!review) throw new NotFoundException('Provider review not found');
    return review;
  }

  async update(id: string, data: UpdateProviderReviewDto) {
    await this.findOne(id);
    return this.prisma.providerReview.update({
      where: { id },
      data,
      include: this.includeRelations(),
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.providerReview.delete({ where: { id } });
    return { message: 'Provider review deleted successfully' };
  }

  /**
   * What a review answer carries about its order and people: names and pictures only. (It used to carry their whole
   * user rows, phone numbers and emails included.)
   */
  private includeRelations() {
    const person = { select: { id: true, name: true, username: true, profilePhoto: true } };
    return {
      order: { select: { id: true, referenceCode: true, orderStatus: true, completedAt: true } },
      provider: { select: { id: true, companyName: true, user: person } },
      customer: { select: { id: true, user: person } },
    };
  }

  private async assertOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new BadRequestException('Order not found');
  }

  private async assertProvider(providerId: string) {
    const provider = await this.prisma.providerProfile.findUnique({
      where: { id: providerId },
    });
    if (!provider) throw new BadRequestException('Provider profile not found');
  }

  private async assertCustomer(customerId: string) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: customerId },
    });
    if (!customer) throw new BadRequestException('Customer profile not found');
  }
}

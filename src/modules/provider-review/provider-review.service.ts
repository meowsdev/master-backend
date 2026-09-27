import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateProviderReviewDto,
  UpdateProviderReviewDto,
} from './dto/provider-review.dto';

@Injectable()
export class ProviderReviewService {
  constructor(private readonly prisma: PrismaService) { }

  async create(data: CreateProviderReviewDto) {
    await this.assertOrder(data.orderId);
    await this.assertProvider(data.providerId);
    await this.assertCustomer(data.customerId);

    const isPositive = data.customerRating >= 4
    const isPublic = isPositive
    const moderationStatus = isPositive ? "APPROVED" : "PENDING"
    const continueWithProvider = isPositive ? (data.continueWithProvider ?? true) : false

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.providerReview.upsert({
        where: { orderId: data.orderId },
        update: {
          ...data,
          isPublic,
          moderationStatus,
          continueWithProvider,
        },
        create: {
          ...data,
          isPublic,
          moderationStatus,
          continueWithProvider,
        },
        include: this.includeRelations()
      })

      if (!isPositive) {
        await tx.activeChatSlot.updateMany({
          where: {
            providerId: data.providerId,
            customerId: data.customerId,
            status: { in: ['ACTIVE', 'PAUSED'] }
          },
          data: {
            status: 'CLOSED'
          }
        })

        await tx.customerRetention.updateMany({
          where: {
            providerId: data.providerId,
            customerId: data.customerId,
          },
          data: {
            isChatActive: false,
            removedReason: 'Auto-removed due to negative review (Rating <= 3)'
          }
        })
      } else {
        const agg = await tx.providerReview.aggregate({
          where: {
            providerId: data.providerId,
            isPublic: true,
            moderationStatus: 'APPROVED',
          },
          _avg: {
            customerRating: true
          }
        })

        if (agg._avg.customerRating !== null) {
          await tx.providerProfile.update({
            where: { id: data.providerId },
            data: {
              rating: Number(agg._avg.customerRating.toFixed(2))
            }
          })
        }
      }
      return review
    })
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

  private includeRelations() {
    return {
      order: true,
      provider: { include: { user: true } },
      customer: { include: { user: true } },
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

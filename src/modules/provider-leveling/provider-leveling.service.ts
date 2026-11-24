import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStatus, Prisma, ProviderLevel } from '@prisma/client';
import { LEVEL_ORDER, LEVEL_RULES, LEVEL_WINDOW_DAYS, levelFor, nextEvaluationDate } from './level-rules';

@Injectable()
export class ProviderLevelingService {
  private readonly logger = new Logger(ProviderLevelingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Run on the 1st of every month at 00:00 (Midnight)
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async handleMonthlyLevelingCron() {
    this.logger.log('Starting monthly provider leveling cron job...');
    const result = await this.runLevelingProcess();
    this.logger.log(
      `Monthly leveling completed: ${JSON.stringify(result.summary)}`,
    );
  }

  /** Orders finished inside the level window. An order completed before completedAt existed counts by its creation date. */
  private recentCompletedWhere(now = new Date()): Prisma.OrderWhereInput {
    const since = new Date(now.getTime() - LEVEL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    return {
      orderStatus: OrderStatus.COMPLETED,
      OR: [{ completedAt: { gte: since } }, { completedAt: null, createdAt: { gte: since } }],
    };
  }

  async runLevelingProcess() {
    const providers = await this.prisma.providerProfile.findMany({
      include: {
        orders: {
          where: this.recentCompletedWhere(),
          select: {
            id: true,
            totalPrice: true,
          },
        },
        providerReviews: {
          where: {
            isPublic: true,
          },
          select: {
            customerRating: true,
          },
        },
      },
    });

    const summary = {
      totalEvaluated: providers.length,
      [ProviderLevel.PLATINUM]: 0,
      [ProviderLevel.GOLD]: 0,
      [ProviderLevel.SILVER]: 0,
      [ProviderLevel.BRONZE]: 0,
      [ProviderLevel.NEW]: 0,
    };

    let updatedCount = 0;

    for (const provider of providers) {
      const reviewCount = provider.providerReviews.length;
      const averageRating =
        reviewCount > 0
          ? provider.providerReviews.reduce(
              (acc, r) => acc + Number(r.customerRating),
              0,
            ) / reviewCount
          : Number(provider.rating || 0);

      // PRD Provider Leveling Rules (level-rules.ts)
      const newLevel = levelFor(provider.orders.length, averageRating);
      summary[newLevel]++;

      if (provider.level !== newLevel) {
        await this.prisma.providerProfile.update({
          where: { id: provider.id },
          data: { level: newLevel },
        });
        updatedCount++;
      }
    }

    return {
      message: `Successfully evaluated ${providers.length} providers. Updated ${updatedCount} levels.`,
      updatedCount,
      summary,
    };
  }

  /**
   * The signed-in provider's level page: the level they hold now, where their numbers stand today, every
   * level's requirements, and what is still missing for the next one. The level itself only changes at the
   * monthly evaluation, so "would reach" can be higher than the level they hold.
   */
  async getMyLevel(userId: string) {
    const provider = await this.prisma.providerProfile.findUnique({
      where: { userId },
      select: { id: true, level: true, rating: true, totalCompletedOrders: true },
    });
    if (!provider) throw new NotFoundException('Provider profile not found');

    const [recentOrders, reviews] = await Promise.all([
      this.prisma.order.count({ where: { providerId: provider.id, ...this.recentCompletedWhere() } }),
      this.prisma.providerReview.aggregate({ where: { providerId: provider.id, isPublic: true }, _avg: { customerRating: true }, _count: true }),
    ]);
    // The same rating the monthly evaluation uses: public reviews, or the stored rating before the first one.
    const rating = reviews._count > 0 ? Number(reviews._avg.customerRating ?? 0) : Number(provider.rating);
    const roundedRating = Math.round(rating * 100) / 100;

    const currentIndex = LEVEL_ORDER.indexOf(provider.level);
    const nextLevel = LEVEL_ORDER[currentIndex + 1] ?? null;
    const nextRule = nextLevel ? LEVEL_RULES.find((rule) => rule.level === nextLevel)! : null;

    return {
      level: provider.level,
      nextLevel,
      // The level these numbers would earn at the next evaluation.
      projectedLevel: levelFor(recentOrders, rating),
      nextEvaluationAt: nextEvaluationDate(),
      windowDays: LEVEL_WINDOW_DAYS,
      metrics: {
        completedOrdersInWindow: recentOrders,
        rating: roundedRating,
        reviewCount: reviews._count,
        totalCompletedOrders: provider.totalCompletedOrders,
      },
      requirementsForNext: nextRule
        ? [
            { key: 'orders', current: recentOrders, target: nextRule.minOrders, isMet: recentOrders >= nextRule.minOrders },
            { key: 'rating', current: roundedRating, target: nextRule.minRating, isMet: rating >= nextRule.minRating },
          ]
        : [],
      levels: LEVEL_ORDER.map((level) => {
        const rule = LEVEL_RULES.find((item) => item.level === level)!;
        return { level, minOrders: rule.minOrders, minRating: rule.minRating, isReached: LEVEL_ORDER.indexOf(level) <= currentIndex };
      }),
    };
  }

  async getLevelDistribution() {
    const providers = await this.prisma.providerProfile.findMany({
      select: {
        id: true,
        level: true,
        rating: true,
        walletBalance: true,
        user: {
          select: {
            name: true,
            mobileNumber: true,
          },
        },
      },
    });

    const counts = {
      [ProviderLevel.PLATINUM]: 0,
      [ProviderLevel.GOLD]: 0,
      [ProviderLevel.SILVER]: 0,
      [ProviderLevel.BRONZE]: 0,
      [ProviderLevel.NEW]: 0,
    };

    for (const p of providers) {
      counts[p.level] = (counts[p.level] || 0) + 1;
    }

    return {
      totalProviders: providers.length,
      distribution: counts,
      providers,
    };
  }
}

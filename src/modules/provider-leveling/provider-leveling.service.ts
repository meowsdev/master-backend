import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderLevel } from '@prisma/client';

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

  async runLevelingProcess() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const providers = await this.prisma.providerProfile.findMany({
      include: {
        orders: {
          where: {
            orderStatus: 'COMPLETED',
            createdAt: {
              gte: thirtyDaysAgo,
            },
          },
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
      const completedOrdersCount = provider.orders.length;
      const reviewCount = provider.providerReviews.length;
      const averageRating =
        reviewCount > 0
          ? provider.providerReviews.reduce(
              (acc, r) => acc + Number(r.customerRating),
              0,
            ) / reviewCount
          : Number(provider.rating || 0);

      let newLevel: ProviderLevel = ProviderLevel.NEW;

      // PRD Provider Leveling Rules
      if (averageRating >= 4.8 && completedOrdersCount >= 50) {
        newLevel = ProviderLevel.PLATINUM;
      } else if (averageRating >= 4.5 && completedOrdersCount >= 25) {
        newLevel = ProviderLevel.GOLD;
      } else if (averageRating >= 4.0 && completedOrdersCount >= 10) {
        newLevel = ProviderLevel.SILVER;
      } else if (averageRating >= 3.5 && completedOrdersCount >= 3) {
        newLevel = ProviderLevel.BRONZE;
      } else {
        newLevel = ProviderLevel.NEW;
      }

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

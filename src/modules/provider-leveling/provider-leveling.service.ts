import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { OfferStatus, OrderStatus, ProviderLevel } from '@prisma/client';
import {
  DEFAULT_LEVEL_TARGETS,
  LEVEL_ORDER,
  LevelMetrics,
  LevelTargetTable,
  METRIC_KEYS,
  MetricKey,
  REVIEW_WINDOW_DAYS,
  TARGET_LEVELS,
  TargetLevel,
  isMetricMet,
  levelFor,
  nextEvaluationDate,
  targetsProblem,
} from './level-rules';

/** A finished order rated below this many stars does not count as a success. */
const SUCCESS_MIN_STARS = 4;

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

type ProviderForLevel = { id: string; level: ProviderLevel; rating: unknown; isLevelLocked: boolean; levelLockReason: string | null };
const PROVIDER_LEVEL_SELECT = { id: true, level: true, rating: true, isLevelLocked: true, levelLockReason: true } as const;

@Injectable()
export class ProviderLevelingService {
  private readonly logger = new Logger(ProviderLevelingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Run on the 1st of every month at 00:00 (Midnight)
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async handleMonthlyLevelingCron() {
    this.logger.log('Starting monthly provider leveling cron job...');
    const result = await this.runLevelingProcess();
    this.logger.log(`Monthly leveling completed: ${JSON.stringify(result.summary)}`);
  }

  /** The targets an admin set (LevelSetting); the starting values for any level not saved yet. */
  async targets(): Promise<LevelTargetTable> {
    const rows = await this.prisma.levelSetting.findMany();
    const table: LevelTargetTable = structuredClone(DEFAULT_LEVEL_TARGETS);
    for (const row of rows) {
      if (row.level === ProviderLevel.LEVEL_0) continue;
      table[row.level] = {
        successScore: Number(row.successScore),
        rating: Number(row.rating),
        responseRate: row.responseRate,
        orders: row.orders,
        uniqueClients: row.uniqueClients,
        earnings: row.earnings,
      };
    }
    return table;
  }

  /** The six numbers of one provider (see level-rules.ts for what each means). */
  async metricsFor(provider: { id: string; rating: unknown }, now = new Date()): Promise<LevelMetrics> {
    const since = new Date(now.getTime() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [ended, offers, reviews, completed] = await Promise.all([
      // Orders that ended with this provider inside the window: completed, cancelled after they took it, or disputed.
      this.prisma.order.findMany({
        where: {
          providerId: provider.id,
          OR: [
            { orderStatus: OrderStatus.COMPLETED, completedAt: { gte: since } },
            { orderStatus: OrderStatus.COMPLETED, completedAt: null, updatedAt: { gte: since } },
            { orderStatus: OrderStatus.CANCELLED, acceptedAt: { not: null }, updatedAt: { gte: since } },
            { orderStatus: OrderStatus.DISPUTED, updatedAt: { gte: since } },
          ],
        },
        select: {
          orderStatus: true,
          revisions: { where: { wasQualityIssue: true }, select: { id: true } },
          providerReview: { select: { customerRating: true } },
        },
      }),
      // Answered or missed offers; withdrawn ones (someone else took the order first) and live ones do not count.
      this.prisma.orderOffer.groupBy({
        by: ['status'],
        where: { providerId: provider.id, createdAt: { gte: since }, status: { in: [OfferStatus.ACCEPTED, OfferStatus.DECLINED, OfferStatus.EXPIRED] } },
        _count: true,
      }),
      this.prisma.providerReview.aggregate({ where: { providerId: provider.id, isPublic: true }, _avg: { customerRating: true }, _count: true }),
      this.prisma.order.findMany({
        where: { providerId: provider.id, orderStatus: OrderStatus.COMPLETED },
        select: { customerId: true, totalPrice: true, adminCommission: true, paymentAndTip: { select: { tipAmount: true } } },
      }),
    ]);

    const successes = ended.filter(
      (order) =>
        order.orderStatus === OrderStatus.COMPLETED &&
        order.revisions.length === 0 &&
        (order.providerReview === null || order.providerReview.customerRating >= SUCCESS_MIN_STARS),
    ).length;

    const offerCount = offers.reduce((sum, row) => sum + row._count, 0);
    const answered = offers.filter((row) => row.status !== OfferStatus.EXPIRED).reduce((sum, row) => sum + row._count, 0);

    // Public reviews, or the stored rating before the first one.
    const rating = reviews._count > 0 ? Number(reviews._avg.customerRating ?? 0) : Number(provider.rating ?? 0);

    return {
      successScore: ended.length > 0 ? round((successes / ended.length) * 10, 1) : null,
      rating: round(rating, 2),
      responseRate: offerCount > 0 ? Math.round((answered / offerCount) * 100) : null,
      orders: completed.length,
      uniqueClients: new Set(completed.map((order) => order.customerId)).size,
      earnings: Math.round(
        completed.reduce((sum, order) => sum + Number(order.totalPrice) - Number(order.adminCommission) + Number(order.paymentAndTip?.tipAmount ?? 0), 0),
      ),
    };
  }

  /** Works out every provider's level from their numbers. A level an admin locked is left as it is. */
  async runLevelingProcess() {
    const [providers, table] = await Promise.all([this.prisma.providerProfile.findMany({ select: PROVIDER_LEVEL_SELECT }), this.targets()]);

    const summary: Record<string, number> = { totalEvaluated: providers.length, locked: 0 };
    LEVEL_ORDER.forEach((level) => (summary[level] = 0));

    let updatedCount = 0;
    for (const provider of providers) {
      if (provider.isLevelLocked) {
        summary.locked++;
        summary[provider.level]++;
        continue;
      }
      const newLevel = levelFor(await this.metricsFor(provider), table);
      summary[newLevel]++;
      if (provider.level !== newLevel) {
        await this.prisma.providerProfile.update({ where: { id: provider.id }, data: { level: newLevel } });
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
   * One provider's Level page, for the provider and for staff: the level they hold, each of the six numbers against
   * the next level's target (their own level's at Top Rated), and every level's targets. The level itself only
   * changes at the monthly evaluation (or by an admin), so "would reach" can differ from the level they hold.
   */
  private async levelPage(provider: ProviderForLevel) {
    const [metrics, table] = await Promise.all([this.metricsFor(provider), this.targets()]);
    const currentIndex = LEVEL_ORDER.indexOf(provider.level);
    const nextLevel = LEVEL_ORDER[currentIndex + 1] ?? null;
    // At Top Rated the targets to keep are their own.
    const goal = table[(nextLevel ?? provider.level) as TargetLevel];

    return {
      level: provider.level,
      nextLevel,
      projectedLevel: levelFor(metrics, table),
      isLevelLocked: provider.isLevelLocked,
      levelLockReason: provider.levelLockReason,
      nextEvaluationAt: nextEvaluationDate(),
      windowDays: REVIEW_WINDOW_DAYS,
      levels: LEVEL_ORDER.map((level) => ({ level, isReached: LEVEL_ORDER.indexOf(level) <= currentIndex })),
      metrics: METRIC_KEYS.map((key) => ({
        key,
        value: metrics[key],
        target: goal[key],
        isMet: isMetricMet(key, metrics, goal),
        // Every level's target, for the "Level 1 / Level 2 / Top Rated target" rows.
        targets: { LEVEL_1: table.LEVEL_1[key], LEVEL_2: table.LEVEL_2[key], TOP_RATED: table.TOP_RATED[key] },
      })),
    };
  }

  private async providerByUser(userId: string): Promise<ProviderForLevel> {
    const provider = await this.prisma.providerProfile.findUnique({ where: { userId }, select: PROVIDER_LEVEL_SELECT });
    if (!provider) throw new NotFoundException('Provider profile not found');
    return provider;
  }

  /** The signed-in provider's own Level page. */
  async getMyLevel(userId: string) {
    return this.levelPage(await this.providerByUser(userId));
  }

  /** Staff: the same Level page for any provider (by their user id). */
  async getProviderLevel(userId: string) {
    return this.levelPage(await this.providerByUser(userId));
  }

  /**
   * Admin: give a provider a level by hand. Locked, the monthly evaluation leaves it alone; unlocked, it only stands
   * until the next evaluation. Returns their Level page.
   */
  async setProviderLevel(userId: string, input: { level: ProviderLevel; isLocked: boolean; reason?: string }) {
    const provider = await this.providerByUser(userId);
    const reason = input.reason?.trim() || null;
    const updated = await this.prisma.providerProfile.update({
      where: { id: provider.id },
      data: { level: input.level, isLevelLocked: input.isLocked, levelLockReason: input.isLocked ? reason : null },
      select: PROVIDER_LEVEL_SELECT,
    });
    return this.levelPage(updated);
  }

  /**
   * Admin: give many providers the same level at once (the Levels tab). Locked, the monthly evaluation leaves them
   * alone; unlocked, the level only stands until the next evaluation. Returns how many changed.
   */
  async setLevelForMany(userIds: string[], input: { level: ProviderLevel; isLocked: boolean; reason?: string }) {
    const reason = input.reason?.trim() || null;
    const updated = await this.prisma.providerProfile.updateMany({
      where: { userId: { in: [...new Set(userIds)] } },
      data: { level: input.level, isLevelLocked: input.isLocked, levelLockReason: input.isLocked ? reason : null },
    });
    return { updatedCount: updated.count };
  }

  /** Staff: every provider with the level they hold, for the Levels tab. */
  async listProviders() {
    const providers = await this.prisma.providerProfile.findMany({
      select: {
        id: true,
        userId: true,
        companyName: true,
        level: true,
        isLevelLocked: true,
        levelLockReason: true,
        rating: true,
        totalCompletedOrders: true,
        user: { select: { name: true, username: true, mobileNumber: true, profilePhoto: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return providers.map((provider) => ({
      providerId: provider.id,
      userId: provider.userId,
      name: provider.companyName || provider.user.name || provider.user.username || provider.user.mobileNumber,
      mobileNumber: provider.user.mobileNumber,
      profilePhoto: provider.user.profilePhoto,
      level: provider.level,
      isLevelLocked: provider.isLevelLocked,
      levelLockReason: provider.levelLockReason,
      rating: Number(provider.rating),
      totalCompletedOrders: provider.totalCompletedOrders,
    }));
  }

  /** Admin: change what one number needs at Level 1, Level 2 and Top Rated. Returns the whole table. */
  async setMetricTargets(key: MetricKey, values: Record<TargetLevel, number>, adminId: string) {
    const problem = targetsProblem(key, values);
    if (problem) throw new BadRequestException(problem);

    const table = await this.targets();
    await this.prisma.$transaction(
      TARGET_LEVELS.map((level) => {
        // A level never saved before is written whole, from its current (default) targets.
        const row = { ...table[level], [key]: values[level] };
        return this.prisma.levelSetting.upsert({
          where: { level },
          update: { [key]: values[level], updatedById: adminId },
          create: { level, ...row, updatedById: adminId },
        });
      }),
    );
    return this.targets();
  }

  async getLevelDistribution() {
    const providers = await this.prisma.providerProfile.findMany({
      select: { id: true, level: true, isLevelLocked: true, rating: true, walletBalance: true, user: { select: { name: true, mobileNumber: true } } },
    });

    const counts: Record<string, number> = {};
    LEVEL_ORDER.forEach((level) => (counts[level] = 0));
    for (const p of providers) counts[p.level] = (counts[p.level] || 0) + 1;

    return { totalProviders: providers.length, distribution: counts, providers };
  }
}

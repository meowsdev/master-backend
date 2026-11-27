import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OfferStatus,
  OrderStatus,
  ProviderLevel,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LevelMetrics,
  REVIEW_WINDOW_DAYS,
} from '../provider-leveling/level-rules';

/**
 * What the ranking needs from the Level system: one provider's numbers. A token, not the leveling class, so this
 * service (and the dispatcher that uses it) stays unit-testable without the scheduler package.
 */
export const LEVEL_METRICS = Symbol('LEVEL_METRICS');
export interface LevelMetricsSource {
  metricsFor(provider: { id: string; rating: unknown }): Promise<LevelMetrics>;
}
import {
  DEFAULT_WEIGHTS,
  MAX_WEIGHT,
  ProviderRankingStats,
  RANKING_FACTORS,
  RankingWeights,
  behaviourScore,
  rankProviders,
} from './ranking-rules';

const SETTINGS_ID = 'default';
/** How long a provider has to answer an offer (the same setting the dispatcher uses). */
export const offerSeconds = () =>
  Number(process.env.DISPATCH_OFFER_SECONDS) || 90;

export interface DispatchSettings {
  isEnabled: boolean;
  weights: RankingWeights;
}

/**
 * The admin's dispatch ranking: the on/off switch, the weights, and each provider's stored numbers. The numbers
 * are worked out every 15 minutes (and when an admin turns ranking on), so placing an order only reads them.
 */
@Injectable()
export class ProviderRankingService {
  private readonly logger = new Logger(ProviderRankingService.name);
  private isRefreshing = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LEVEL_METRICS) private readonly leveling: LevelMetricsSource,
  ) {}

  async getSettings(): Promise<DispatchSettings> {
    const row = await this.prisma.dispatchSetting.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (!row) return { isEnabled: false, weights: { ...DEFAULT_WEIGHTS } };
    const weights = Object.fromEntries(
      RANKING_FACTORS.map((factor) => [factor, row[factor]]),
    ) as RankingWeights;
    return { isEnabled: row.isEnabled, weights };
  }

  /** Applies to the next wave of every order. Turning it on refreshes the numbers first, so nobody is ranked blind. */
  async updateSettings(
    input: { isEnabled: boolean; weights: RankingWeights },
    adminId: string,
  ): Promise<DispatchSettings> {
    const weights = Object.fromEntries(
      RANKING_FACTORS.map((factor) => [
        factor,
        Math.min(
          MAX_WEIGHT,
          Math.max(0, Math.round(input.weights[factor] ?? 0)),
        ),
      ]),
    ) as RankingWeights;
    const wasEnabled = (await this.getSettings()).isEnabled;
    if (input.isEnabled && !wasEnabled) await this.refreshAllStats();
    const data = {
      isEnabled: input.isEnabled,
      ...weights,
      updatedById: adminId,
    };
    await this.prisma.dispatchSetting.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    return this.getSettings();
  }

  /** Stored numbers for these providers; a provider not refreshed yet is simply missing (ranked as middling). */
  async statsFor(
    providerIds: string[],
  ): Promise<Map<string, ProviderRankingStats>> {
    const rows = await this.prisma.providerDispatchStats.findMany({
      where: { providerId: { in: providerIds } },
    });
    return new Map(
      rows.map((row) => [
        row.providerId,
        {
          responseRate: row.responseRate,
          avgResponseSeconds: row.avgResponseSeconds,
          successScore:
            row.successScore === null ? null : Number(row.successScore),
          rating: row.rating === null ? null : Number(row.rating),
          behaviour: row.behaviour,
          level: row.level,
          completedOrders: row.completedOrders,
          activeOrders: row.activeOrders,
        },
      ]),
    );
  }

  /** Candidates best first when ranking is on; null when it is off (the caller keeps its own order). */
  async rank(candidateIds: string[]): Promise<string[] | null> {
    const settings = await this.getSettings();
    if (!settings.isEnabled || candidateIds.length < 2) return null;
    return rankProviders(
      candidateIds,
      await this.statsFor(candidateIds),
      settings.weights,
      offerSeconds(),
    );
  }

  /** Called every 15 minutes by ProviderRankingScheduler. */
  async handleRefreshCron() {
    // Off: nothing reads the numbers, so the database is spared the work.
    if (!(await this.getSettings()).isEnabled) return;
    await this.refreshAllStats();
  }

  /** Works out every active provider's numbers again. One run at a time; one provider failing does not stop the rest. */
  async refreshAllStats(): Promise<{ refreshed: number; failed: number }> {
    if (this.isRefreshing) return { refreshed: 0, failed: 0 };
    this.isRefreshing = true;
    let refreshed = 0;
    let failed = 0;
    try {
      const providers = await this.prisma.providerProfile.findMany({
        where: { user: { role: UserRole.PROVIDER, status: 'ACTIVE' } },
        select: { id: true, rating: true, level: true, walletBalance: true },
      });
      for (const provider of providers) {
        try {
          await this.refreshOne(provider);
          refreshed += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn(
            `Dispatch stats not refreshed for provider ${provider.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } finally {
      this.isRefreshing = false;
    }
    return { refreshed, failed };
  }

  private async refreshOne(provider: {
    id: string;
    rating: unknown;
    level: ProviderLevel;
    walletBalance: unknown;
  }) {
    const since = new Date(
      Date.now() - REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const [metrics, answered, reminders, activeOrders, reviewCount] =
      await Promise.all([
        this.leveling.metricsFor(provider),
        this.prisma.orderOffer.findMany({
          where: {
            providerId: provider.id,
            createdAt: { gte: since },
            status: { in: [OfferStatus.ACCEPTED, OfferStatus.DECLINED] },
            respondedAt: { not: null },
          },
          select: { createdAt: true, respondedAt: true },
        }),
        this.prisma.dueReminder.count({
          where: { providerId: provider.id, createdAt: { gte: since } },
        }),
        this.prisma.order.count({
          where: {
            providerId: provider.id,
            orderStatus: {
              in: [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS],
            },
          },
        }),
        this.prisma.providerReview.count({
          where: { providerId: provider.id, isPublic: true },
        }),
      ]);

    const seconds = answered.map((offer) =>
      Math.max(
        0,
        (offer.respondedAt!.getTime() - offer.createdAt.getTime()) / 1000,
      ),
    );
    const data = {
      responseRate: metrics.responseRate,
      avgResponseSeconds:
        seconds.length > 0
          ? Math.round(
              seconds.reduce((sum, value) => sum + value, 0) / seconds.length,
            )
          : null,
      successScore: metrics.successScore,
      rating: reviewCount > 0 ? metrics.rating : null,
      behaviour: behaviourScore(Number(provider.walletBalance), reminders),
      level: provider.level,
      completedOrders: metrics.orders,
      activeOrders,
      refreshedAt: new Date(),
    };
    await this.prisma.providerDispatchStats.upsert({
      where: { providerId: provider.id },
      create: { providerId: provider.id, ...data },
      update: data,
    });
  }
}

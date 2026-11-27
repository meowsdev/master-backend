import { ProviderLevel } from '@prisma/client';

/**
 * Who gets a new order first. Every eligible provider (right area, right service, active) gets a dispatch score of
 * 0-100 from nine factors, each turned into 0..1 below and counted as much as the admin's weight for it (0-10).
 * score = 100 × Σ(weight × factor) ÷ Σ weight. A factor with no data yet counts as middling (0.5), so a new
 * provider is neither punished nor favoured for missing numbers (the newcomer factor is what favours them).
 *
 * - responseRate: of the offers in the last 60 days, the share answered (accepted or declined) in time.
 * - responseSpeed: how fast they answer: an instant answer is 1, using the whole offer window is 0.
 * - successScore: the Level system's 0-10 (finished well, no quality revision, few cancellations).
 * - rating: public review average out of 5.
 * - behaviour: dealings with the platform: dues paid on time (lower for a negative wallet and for reminders).
 * - level: Level 0 → Top Rated.
 * - experience: completed orders, full marks from EXPERIENCE_FULL_AT.
 * - workload: fewer running orders score higher, so work is spread out instead of piling on a few.
 * - newcomer: a lift for providers with fewer than NEWCOMER_UNTIL completed orders, so new ones get a start.
 */
export const RANKING_FACTORS = [
  'responseRate',
  'responseSpeed',
  'successScore',
  'rating',
  'behaviour',
  'level',
  'experience',
  'workload',
  'newcomer',
] as const;
export type RankingFactor = (typeof RANKING_FACTORS)[number];
export type RankingWeights = Record<RankingFactor, number>;

export const MAX_WEIGHT = 10;
export const EXPERIENCE_FULL_AT = 50;
export const NEWCOMER_UNTIL = 5;
/** Behaviour points taken off for a wallet that is negative right now, and for each due reminder in 60 days. */
export const NEGATIVE_WALLET_PENALTY = 30;
export const REMINDER_PENALTY = 10;
export const MAX_REMINDER_PENALTY = 50;

/** The balanced starting weights (also the database defaults). */
export const DEFAULT_WEIGHTS: RankingWeights = {
  responseRate: 8,
  responseSpeed: 5,
  successScore: 8,
  rating: 6,
  behaviour: 7,
  level: 4,
  experience: 3,
  workload: 5,
  newcomer: 3,
};

/** Ready-made weight sets the admin can start from. */
export const RANKING_PRESETS: Record<
  'BALANCED' | 'RESPONSE_FIRST' | 'QUALITY_FIRST' | 'FAIR_SHARE',
  RankingWeights
> = {
  BALANCED: DEFAULT_WEIGHTS,
  RESPONSE_FIRST: {
    responseRate: 10,
    responseSpeed: 9,
    successScore: 4,
    rating: 3,
    behaviour: 5,
    level: 2,
    experience: 1,
    workload: 3,
    newcomer: 1,
  },
  QUALITY_FIRST: {
    responseRate: 4,
    responseSpeed: 2,
    successScore: 10,
    rating: 9,
    behaviour: 6,
    level: 7,
    experience: 5,
    workload: 2,
    newcomer: 1,
  },
  FAIR_SHARE: {
    responseRate: 6,
    responseSpeed: 3,
    successScore: 5,
    rating: 4,
    behaviour: 6,
    level: 2,
    experience: 1,
    workload: 10,
    newcomer: 8,
  },
};

/** A provider's stored numbers (ProviderDispatchStats). null = no data yet. */
export interface ProviderRankingStats {
  responseRate: number | null;
  avgResponseSeconds: number | null;
  successScore: number | null;
  rating: number | null;
  behaviour: number;
  level: ProviderLevel;
  completedOrders: number;
  activeOrders: number;
}

const NO_DATA = 0.5;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const LEVEL_VALUE: Record<ProviderLevel, number> = {
  LEVEL_0: 0,
  LEVEL_1: 1 / 3,
  LEVEL_2: 2 / 3,
  TOP_RATED: 1,
};

/** Each factor of one provider as 0..1. */
export function factorValues(
  stats: ProviderRankingStats,
  offerSeconds: number,
): Record<RankingFactor, number> {
  return {
    responseRate:
      stats.responseRate === null ? NO_DATA : clamp01(stats.responseRate / 100),
    responseSpeed:
      stats.avgResponseSeconds === null
        ? NO_DATA
        : clamp01(1 - stats.avgResponseSeconds / offerSeconds),
    successScore:
      stats.successScore === null ? NO_DATA : clamp01(stats.successScore / 10),
    rating: stats.rating === null ? NO_DATA : clamp01(stats.rating / 5),
    behaviour: clamp01(stats.behaviour / 100),
    level: LEVEL_VALUE[stats.level],
    experience: clamp01(stats.completedOrders / EXPERIENCE_FULL_AT),
    workload: 1 / (1 + Math.max(0, stats.activeOrders)),
    newcomer:
      stats.completedOrders < NEWCOMER_UNTIL
        ? (NEWCOMER_UNTIL - stats.completedOrders) / NEWCOMER_UNTIL
        : 0,
  };
}

/** The 0-100 score and how many points each factor gave (for the admin's preview). All weights 0 = everyone 50. */
export function dispatchScore(
  stats: ProviderRankingStats,
  weights: RankingWeights,
  offerSeconds: number,
) {
  const values = factorValues(stats, offerSeconds);
  const totalWeight = RANKING_FACTORS.reduce(
    (sum, factor) => sum + Math.max(0, weights[factor]),
    0,
  );
  const parts = Object.fromEntries(
    RANKING_FACTORS.map((factor) => [
      factor,
      totalWeight > 0
        ? (100 * Math.max(0, weights[factor]) * values[factor]) / totalWeight
        : 0,
    ]),
  ) as Record<RankingFactor, number>;
  const score =
    totalWeight > 0
      ? RANKING_FACTORS.reduce((sum, factor) => sum + parts[factor], 0)
      : 50;
  return { score: Math.round(score * 10) / 10, parts, values };
}

/** Behaviour 0-100 from the wallet now and the due reminders in the last 60 days. */
export function behaviourScore(
  walletBalance: number,
  remindersInWindow: number,
): number {
  const penalty =
    (walletBalance < 0 ? NEGATIVE_WALLET_PENALTY : 0) +
    Math.min(MAX_REMINDER_PENALTY, remindersInWindow * REMINDER_PENALTY);
  return Math.max(0, 100 - penalty);
}

/**
 * Orders candidate ids by score, best first. Equal scores keep the order they came in (the old rating order), so a
 * provider with no stats row yet is ranked as if every factor were middling, never dropped.
 */
export function rankProviders(
  candidateIds: string[],
  statsById: Map<string, ProviderRankingStats>,
  weights: RankingWeights,
  offerSeconds: number,
): string[] {
  const blank: ProviderRankingStats = {
    responseRate: null,
    avgResponseSeconds: null,
    successScore: null,
    rating: null,
    behaviour: 100,
    level: ProviderLevel.LEVEL_0,
    completedOrders: 0,
    activeOrders: 0,
  };
  return candidateIds
    .map((id, index) => ({
      id,
      index,
      score: dispatchScore(statsById.get(id) ?? blank, weights, offerSeconds)
        .score,
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.id);
}

import { ProviderLevel } from '@prisma/client';

/**
 * What each provider level needs: completed orders in the last 30 days and an average customer rating.
 * The monthly evaluation and the provider's own "Level" page both read this list, so they never disagree.
 * Highest first.
 */
export const LEVEL_RULES: ReadonlyArray<{ level: ProviderLevel; minOrders: number; minRating: number }> = [
  { level: ProviderLevel.PLATINUM, minOrders: 50, minRating: 4.8 },
  { level: ProviderLevel.GOLD, minOrders: 25, minRating: 4.5 },
  { level: ProviderLevel.SILVER, minOrders: 10, minRating: 4.0 },
  { level: ProviderLevel.BRONZE, minOrders: 3, minRating: 3.5 },
  { level: ProviderLevel.NEW, minOrders: 0, minRating: 0 },
];

/** Lowest first: NEW, BRONZE, SILVER, GOLD, PLATINUM. */
export const LEVEL_ORDER: ProviderLevel[] = [...LEVEL_RULES].reverse().map((rule) => rule.level);

/** The days of completed work a level is judged on. */
export const LEVEL_WINDOW_DAYS = 30;

export function levelFor(completedOrders: number, averageRating: number): ProviderLevel {
  return LEVEL_RULES.find((rule) => completedOrders >= rule.minOrders && averageRating >= rule.minRating)!.level;
}

/** Levels are worked out at midnight on the 1st of each month (the cron in ProviderLevelingService). */
export function nextEvaluationDate(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

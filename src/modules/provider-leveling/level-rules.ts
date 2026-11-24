import { ProviderLevel } from '@prisma/client';

/**
 * Provider levels: Level 0 → Level 1 → Level 2 → Top Rated. A level needs every one of six numbers:
 *
 * - successScore (0-10, last REVIEW_WINDOW_DAYS days): the share of their finished orders that went well, out of 10.
 *   Went well = completed, no revision the provider marked as their quality issue, and rated 4★ or more (or not rated).
 *   Cancelled-after-accepting and disputed orders count against it. No finished order yet = no score, not met.
 * - rating (0-5, lifetime): the average of public customer reviews.
 * - responseRate (0-100 %, last REVIEW_WINDOW_DAYS days): of the new-order offers they got, how many they answered
 *   (accepted or declined) before the offer ran out. No offer yet = nothing missed, met.
 * - orders, uniqueClients, earnings (lifetime): completed orders, different customers served, and net earnings in
 *   taka (bill − platform commission + tips).
 *
 * The targets live in the LevelSetting table, where an admin edits them; the monthly evaluation and every Level page
 * read the same rows, so they never disagree. DEFAULT_LEVEL_TARGETS are the starting values (and the fallback).
 * Earnings targets: $400 / $2,000 / $10,000 at about ৳122 per dollar.
 */
export interface LevelTargets {
  successScore: number;
  rating: number;
  responseRate: number;
  orders: number;
  uniqueClients: number;
  earnings: number;
}

export type MetricKey = keyof LevelTargets;

/** Lowest first. Level 0 is where everyone starts and needs nothing. */
export const LEVEL_ORDER: ProviderLevel[] = [ProviderLevel.LEVEL_0, ProviderLevel.LEVEL_1, ProviderLevel.LEVEL_2, ProviderLevel.TOP_RATED];

export type TargetLevel = Exclude<ProviderLevel, 'LEVEL_0'>;
export type LevelTargetTable = Record<TargetLevel, LevelTargets>;
export const TARGET_LEVELS: TargetLevel[] = [ProviderLevel.LEVEL_1, ProviderLevel.LEVEL_2, ProviderLevel.TOP_RATED];

export const DEFAULT_LEVEL_TARGETS: LevelTargetTable = {
  LEVEL_1: { successScore: 5, rating: 4.4, responseRate: 80, orders: 5, uniqueClients: 3, earnings: 48_800 },
  LEVEL_2: { successScore: 7, rating: 4.6, responseRate: 90, orders: 20, uniqueClients: 10, earnings: 244_000 },
  TOP_RATED: { successScore: 8, rating: 4.7, responseRate: 90, orders: 40, uniqueClients: 20, earnings: 1_220_000 },
};

/** Success score, rating and response rate look at this many recent days. */
export const REVIEW_WINDOW_DAYS = 60;

/** A provider's six numbers. null = no data yet (no finished order for the score, no offer for the response rate). */
export interface LevelMetrics {
  successScore: number | null;
  rating: number;
  responseRate: number | null;
  orders: number;
  uniqueClients: number;
  earnings: number;
}

/** Whether one number meets its target. No success score yet never qualifies; no offer yet means none was missed. */
export function isMetricMet(key: MetricKey, metrics: LevelMetrics, targets: LevelTargets): boolean {
  const value = metrics[key];
  if (value === null) return key === 'responseRate';
  return value >= targets[key];
}

export const METRIC_KEYS: MetricKey[] = ['successScore', 'rating', 'responseRate', 'orders', 'uniqueClients', 'earnings'];

/** What an admin may set for each number: its range, and how many decimals it keeps. */
export const METRIC_LIMITS: Record<MetricKey, { min: number; max: number; decimals: number }> = {
  successScore: { min: 0, max: 10, decimals: 1 },
  rating: { min: 0, max: 5, decimals: 2 },
  responseRate: { min: 0, max: 100, decimals: 0 },
  orders: { min: 0, max: 100_000, decimals: 0 },
  uniqueClients: { min: 0, max: 100_000, decimals: 0 },
  earnings: { min: 0, max: 1_000_000_000, decimals: 0 },
};

export function meetsLevel(level: ProviderLevel, metrics: LevelMetrics, table: LevelTargetTable): boolean {
  if (level === ProviderLevel.LEVEL_0) return true;
  const targets = table[level];
  return METRIC_KEYS.every((key) => isMetricMet(key, metrics, targets));
}

/** The highest level whose every target is met. Levels are climbed in order: Level 2 needs Level 1's targets too (never higher, see targetsProblem). */
export function levelFor(metrics: LevelMetrics, table: LevelTargetTable = DEFAULT_LEVEL_TARGETS): ProviderLevel {
  let reached: ProviderLevel = ProviderLevel.LEVEL_0;
  for (const level of LEVEL_ORDER.slice(1)) {
    if (!meetsLevel(level, metrics, table)) break;
    reached = level;
  }
  return reached;
}

/** Levels are worked out at midnight on the 1st of each month (the cron in ProviderLevelingService). */
export function nextEvaluationDate(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

/**
 * Why a metric's new targets cannot be saved, or null when they can: each must be inside its range, and a higher
 * level may never ask for less than a lower one (Level 1 <= Level 2 <= Top Rated).
 */
export function targetsProblem(key: MetricKey, values: Record<TargetLevel, number>): string | null {
  const limits = METRIC_LIMITS[key];
  for (const level of TARGET_LEVELS) {
    const value = values[level];
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${level}: a number is needed`;
    if (value < limits.min || value > limits.max) return `${level}: must be between ${limits.min} and ${limits.max}`;
    // A tolerance, since 4.4 * 100 is 440.00000000000006 in floating point.
    const scaled = value * 10 ** limits.decimals;
    if (Math.abs(Math.round(scaled) - scaled) > 1e-6) return `${level}: at most ${limits.decimals} decimal place(s)`;
  }
  if (values.LEVEL_1 > values.LEVEL_2 || values.LEVEL_2 > values.TOP_RATED) return 'A higher level cannot need less than a lower one';
  return null;
}

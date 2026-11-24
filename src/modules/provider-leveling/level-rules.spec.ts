import { DEFAULT_LEVEL_TARGETS as LEVEL_TARGETS, LEVEL_ORDER, LevelMetrics, isMetricMet, levelFor, nextEvaluationDate, targetsProblem } from './level-rules';

const fresh: LevelMetrics = { successScore: null, rating: 0, responseRate: null, orders: 0, uniqueClients: 0, earnings: 0 };
const level1: LevelMetrics = { successScore: 5, rating: 4.4, responseRate: 80, orders: 5, uniqueClients: 3, earnings: 48_800 };
const level2: LevelMetrics = { successScore: 7, rating: 4.6, responseRate: 90, orders: 20, uniqueClients: 10, earnings: 244_000 };
const topRated: LevelMetrics = { successScore: 8, rating: 4.7, responseRate: 90, orders: 40, uniqueClients: 20, earnings: 1_220_000 };

describe('provider level rules', () => {
  it('lists levels lowest first', () => {
    expect(LEVEL_ORDER).toEqual(['LEVEL_0', 'LEVEL_1', 'LEVEL_2', 'TOP_RATED']);
  });

  it('gives the highest level whose six targets are all met', () => {
    expect(levelFor(fresh)).toBe('LEVEL_0');
    expect(levelFor(level1)).toBe('LEVEL_1');
    expect(levelFor(level2)).toBe('LEVEL_2');
    expect(levelFor(topRated)).toBe('TOP_RATED');
  });

  it('is held down by any one missing target', () => {
    // Plenty of everything, but too few different customers for Level 2.
    expect(levelFor({ ...topRated, uniqueClients: 9 })).toBe('LEVEL_1');
    // The rating alone keeps them at Level 0.
    expect(levelFor({ ...topRated, rating: 4.3 })).toBe('LEVEL_0');
    // Not enough earnings for Top Rated.
    expect(levelFor({ ...topRated, earnings: 1_000_000 })).toBe('LEVEL_2');
  });

  it('never qualifies without a success score, but a provider never offered an order has missed none', () => {
    expect(levelFor({ ...level1, successScore: null })).toBe('LEVEL_0');
    expect(levelFor({ ...level1, responseRate: null })).toBe('LEVEL_1');
    expect(isMetricMet('responseRate', fresh, LEVEL_TARGETS.LEVEL_1)).toBe(true);
    expect(isMetricMet('successScore', fresh, LEVEL_TARGETS.LEVEL_1)).toBe(false);
  });

  it('follows the targets it is given (the admin-edited table)', () => {
    const easier = { ...LEVEL_TARGETS, LEVEL_1: { ...LEVEL_TARGETS.LEVEL_1, orders: 1, uniqueClients: 1, earnings: 0 } };
    const starter = { ...level1, orders: 1, uniqueClients: 1, earnings: 0 };
    expect(levelFor(starter)).toBe('LEVEL_0');
    expect(levelFor(starter, easier)).toBe('LEVEL_1');
  });

  it('accepts only targets in range that never fall at a higher level', () => {
    expect(targetsProblem('orders', { LEVEL_1: 5, LEVEL_2: 20, TOP_RATED: 40 })).toBeNull();
    expect(targetsProblem('orders', { LEVEL_1: 30, LEVEL_2: 20, TOP_RATED: 40 })).toMatch('higher level');
    expect(targetsProblem('rating', { LEVEL_1: 4.4, LEVEL_2: 4.6, TOP_RATED: 6 })).toMatch('between');
    expect(targetsProblem('orders', { LEVEL_1: 5.5, LEVEL_2: 20, TOP_RATED: 40 })).toMatch('decimal');
    expect(targetsProblem('successScore', { LEVEL_1: 5.5, LEVEL_2: 7, TOP_RATED: 8 })).toBeNull();
    expect(targetsProblem('rating', { LEVEL_1: 4.4, LEVEL_2: 4.6, TOP_RATED: 4.75 })).toBeNull();
  });

  it('is evaluated next on the 1st of the coming month', () => {
    expect(nextEvaluationDate(new Date(2026, 10, 24))).toEqual(new Date(2026, 11, 1));
    expect(nextEvaluationDate(new Date(2026, 11, 31))).toEqual(new Date(2027, 0, 1));
  });
});

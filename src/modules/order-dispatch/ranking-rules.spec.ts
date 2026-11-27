import { ProviderLevel } from '@prisma/client';
import {
  DEFAULT_WEIGHTS,
  ProviderRankingStats,
  RankingWeights,
  behaviourScore,
  dispatchScore,
  factorValues,
  rankProviders,
} from './ranking-rules';

const base: ProviderRankingStats = {
  responseRate: 90,
  avgResponseSeconds: 30,
  successScore: 8,
  rating: 4.5,
  behaviour: 100,
  level: ProviderLevel.LEVEL_1,
  completedOrders: 20,
  activeOrders: 1,
};
const only = (factor: keyof RankingWeights): RankingWeights => ({
  responseRate: 0,
  responseSpeed: 0,
  successScore: 0,
  rating: 0,
  behaviour: 0,
  level: 0,
  experience: 0,
  workload: 0,
  newcomer: 0,
  [factor]: 10,
});

describe('factor values', () => {
  it('turns each number into 0..1', () => {
    const values = factorValues(base, 90);
    expect(values.responseRate).toBeCloseTo(0.9);
    expect(values.responseSpeed).toBeCloseTo(2 / 3);
    expect(values.successScore).toBeCloseTo(0.8);
    expect(values.rating).toBeCloseTo(0.9);
    expect(values.level).toBeCloseTo(1 / 3);
    expect(values.experience).toBeCloseTo(0.4);
    expect(values.workload).toBeCloseTo(0.5);
    expect(values.newcomer).toBe(0);
  });

  it('counts missing data as middling, never as zero', () => {
    const values = factorValues(
      {
        ...base,
        responseRate: null,
        avgResponseSeconds: null,
        successScore: null,
        rating: null,
      },
      90,
    );
    expect([
      values.responseRate,
      values.responseSpeed,
      values.successScore,
      values.rating,
    ]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('lifts a provider with fewer than 5 completed orders, most for the newest', () => {
    expect(factorValues({ ...base, completedOrders: 0 }, 90).newcomer).toBe(1);
    expect(
      factorValues({ ...base, completedOrders: 4 }, 90).newcomer,
    ).toBeCloseTo(0.2);
    expect(factorValues({ ...base, completedOrders: 5 }, 90).newcomer).toBe(0);
  });
});

describe('dispatch score', () => {
  it('is 0-100 and its factor points add up to it', () => {
    const { score, parts } = dispatchScore(base, DEFAULT_WEIGHTS, 90);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(
      Object.values(parts).reduce((sum, part) => sum + part, 0),
    ).toBeCloseTo(score, 0);
  });

  it('follows only the factors the admin weighted', () => {
    expect(
      dispatchScore({ ...base, responseRate: 100 }, only('responseRate'), 90)
        .score,
    ).toBe(100);
    expect(
      dispatchScore({ ...base, responseRate: 40 }, only('responseRate'), 90)
        .score,
    ).toBe(40);
  });

  it('gives everyone 50 when every weight is 0', () => {
    expect(
      dispatchScore(base, { ...only('responseRate'), responseRate: 0 }, 90)
        .score,
    ).toBe(50);
  });
});

describe('behaviour with the platform', () => {
  it('is full for a provider who pays dues on time', () => {
    expect(behaviourScore(500, 0)).toBe(100);
  });

  it('drops for a negative wallet and for each due reminder, but not below zero', () => {
    expect(behaviourScore(-200, 0)).toBe(70);
    expect(behaviourScore(0, 2)).toBe(80);
    expect(behaviourScore(-200, 99)).toBe(20);
  });
});

describe('ranking providers', () => {
  it('puts the best responder first when response counts most', () => {
    const stats = new Map([
      ['slow', { ...base, responseRate: 50 }],
      ['fast', { ...base, responseRate: 100 }],
    ]);
    expect(
      rankProviders(['slow', 'fast'], stats, only('responseRate'), 90),
    ).toEqual(['fast', 'slow']);
  });

  it('spreads work: with workload weighted, the provider with fewer running orders comes first', () => {
    const stats = new Map([
      ['busy', { ...base, activeOrders: 4 }],
      ['free', { ...base, activeOrders: 0 }],
    ]);
    expect(
      rankProviders(['busy', 'free'], stats, only('workload'), 90),
    ).toEqual(['free', 'busy']);
  });

  it('keeps the incoming (rating) order on a tie, and never drops a provider without stats', () => {
    const stats = new Map([
      ['a', base],
      ['b', base],
    ]);
    expect(
      rankProviders(['a', 'b', 'no-stats'], stats, only('behaviour'), 90),
    ).toEqual(['a', 'b', 'no-stats']);
  });
});

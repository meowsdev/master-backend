import { LEVEL_ORDER, levelFor, nextEvaluationDate } from './level-rules';

describe('provider level rules', () => {
  it('gives the highest level whose orders and rating are both met', () => {
    expect(levelFor(0, 0)).toBe('NEW');
    expect(levelFor(3, 3.5)).toBe('BRONZE');
    expect(levelFor(10, 4.0)).toBe('SILVER');
    expect(levelFor(25, 4.5)).toBe('GOLD');
    expect(levelFor(50, 4.8)).toBe('PLATINUM');
    // Plenty of orders but a lower rating holds the level down, and the other way round.
    expect(levelFor(80, 4.2)).toBe('SILVER');
    expect(levelFor(4, 5)).toBe('BRONZE');
  });

  it('lists levels lowest first', () => {
    expect(LEVEL_ORDER).toEqual(['NEW', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM']);
  });

  it('is evaluated next on the 1st of the coming month', () => {
    expect(nextEvaluationDate(new Date(2026, 10, 24))).toEqual(new Date(2026, 11, 1));
    expect(nextEvaluationDate(new Date(2026, 11, 31))).toEqual(new Date(2027, 0, 1));
  });
});

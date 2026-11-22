import { calculateQuote } from './order-pricing';

const acWash = { name: 'Master servicing', unitPrice: 1000, isCountable: true, maxCount: 5 };
const hangingYes = { label: 'Yes', unitPrice: 300, isCountable: true };

describe('calculateQuote', () => {
  it('charges a countable problem per unit', () => {
    expect(calculateQuote(acWash, 3, []).total).toBe(3000);
  });

  it('adds a countable surcharge per affected unit', () => {
    const quote = calculateQuote(acWash, 3, [{ questionText: 'q', option: hangingYes, count: 2 }]);
    expect(quote.total).toBe(3600);
  });

  it('ignores the count of a non-countable problem', () => {
    const fixed = { ...acWash, isCountable: false, maxCount: 1 };
    expect(calculateQuote(fixed, 4, []).total).toBe(1000);
  });

  it('rejects more affected units than ordered units', () => {
    expect(() =>
      calculateQuote(acWash, 2, [{ questionText: 'q', option: hangingYes, count: 3 }]),
    ).toThrow();
  });

  it('rejects a count above the admin maximum', () => {
    expect(() => calculateQuote(acWash, 6, [])).toThrow();
  });

  it('adds nothing for a free option', () => {
    const no = { label: 'No', unitPrice: 0, isCountable: false };
    expect(calculateQuote(acWash, 1, [{ questionText: 'q', option: no, count: 1 }]).lines).toHaveLength(1);
  });
});


describe('calculateCartQuote', () => {
  const { calculateCartQuote } = jest.requireActual('./order-pricing');
  const small = { name: 'AC Check Up (1 - 2.5 Ton)', unitPrice: 300, isCountable: true, maxCount: 10, quantity: 2 };
  const gas = { name: 'AC Gas Checkup (Standard)', unitPrice: 418, isCountable: false, maxCount: 1, quantity: 5 };
  const hanging = { questionText: 'Outdoor unit hanging?', option: { label: 'Yes', unitPrice: 300, isCountable: true }, count: 3 };

  it('adds one line per item, counting only countable items', () => {
    const quote = calculateCartQuote([small, gas], []);
    expect(quote.lines.map((item: { count: number }) => item.count)).toEqual([2, 1]);
    expect(quote.total).toBe(600 + 418);
  });

  it('charges a countable answer up to the units in the cart', () => {
    expect(calculateCartQuote([small, gas], [hanging]).total).toBe(600 + 418 + 900);
    expect(() => calculateCartQuote([small], [hanging])).toThrow();
  });

  it('rejects an empty cart and an over-limit quantity', () => {
    expect(() => calculateCartQuote([], [])).toThrow();
    expect(() => calculateCartQuote([{ ...small, quantity: 11 }], [])).toThrow();
  });
});

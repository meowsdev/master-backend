import {
  discountAmount,
  ownOrInherited,
  reviewerName,
  startingPrice,
  summarizeRatings,
} from './catalog-view';

describe('catalog view helpers', () => {
  it('starts from the cheapest variant and keeps its old price only when higher', () => {
    expect(
      startingPrice(
        [
          { price: '482.5', originalPrice: '940.5' },
          { price: '299.63', originalPrice: '757.63' },
        ],
        0,
      ),
    ).toEqual({ price: 299.63, originalPrice: 757.63 });
    expect(startingPrice([{ price: 500, originalPrice: 400 }], 0)).toEqual({
      price: 500,
      originalPrice: null,
    });
  });

  it('falls back to the base price when a sub-service has no variants', () => {
    expect(startingPrice([], '1500')).toEqual({
      price: 1500,
      originalPrice: null,
    });
  });

  it('rounds the discount badge and hides it without a discount', () => {
    expect(discountAmount(299.63, 757.63)).toBe(458);
    expect(discountAmount(300, null)).toBeNull();
    expect(discountAmount(300, 300)).toBeNull();
  });

  it('summarizes ratings into an average and a five-star breakdown', () => {
    expect(summarizeRatings([5, 5, 4, 1])).toEqual({
      average: 3.75,
      count: 4,
      breakdown: [1, 0, 0, 1, 2],
    });
    expect(summarizeRatings([])).toEqual({
      average: null,
      count: 0,
      breakdown: [0, 0, 0, 0, 0],
    });
  });

  it('uses the sub-service list unless it is empty', () => {
    expect(ownOrInherited(['own'], ['main'])).toEqual(['own']);
    expect(ownOrInherited([], ['main'])).toEqual(['main']);
    expect(ownOrInherited(null, undefined)).toEqual([]);
  });

  it('shows reviewers by first name only', () => {
    expect(reviewerName('Asaduzzaman Khan')).toBe('Asaduzzaman');
    expect(reviewerName('  ')).toBe('Customer');
    expect(reviewerName(null)).toBe('Customer');
  });
});

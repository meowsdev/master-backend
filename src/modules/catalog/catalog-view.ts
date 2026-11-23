/**
 * Pure helpers that shape catalog rows for the customer app. No database access, so they are unit tested directly.
 */

export interface VariantPrice {
  price: unknown;
  originalPrice: unknown;
}

/** "Starts from" on a sub-service card: its cheapest variant, and that variant's struck-through price. */
export function startingPrice(
  variants: VariantPrice[],
  fallback: unknown,
): { price: number; originalPrice: number | null } {
  if (variants.length === 0)
    return { price: Number(fallback ?? 0), originalPrice: null };
  const cheapest = variants.reduce((best, variant) =>
    Number(variant.price) < Number(best.price) ? variant : best,
  );
  const original =
    cheapest.originalPrice == null ? null : Number(cheapest.originalPrice);
  return {
    price: Number(cheapest.price),
    originalPrice:
      original !== null && original > Number(cheapest.price) ? original : null,
  };
}

/** Whole-taka saving shown on the card badge ("458 BDT OFF"), or null without a discount. */
export function discountAmount(
  price: number,
  originalPrice: number | null,
): number | null {
  if (originalPrice === null || originalPrice <= price) return null;
  return Math.round(originalPrice - price);
}

export interface RatingSummary {
  average: number | null;
  count: number;
  /** Index 0 = one star ... index 4 = five stars. */
  breakdown: [number, number, number, number, number];
}

export function summarizeRatings(ratings: number[]): RatingSummary {
  const breakdown: RatingSummary['breakdown'] = [0, 0, 0, 0, 0];
  for (const rating of ratings) {
    const star = Math.min(5, Math.max(1, Math.round(rating)));
    breakdown[star - 1] += 1;
  }
  const average = ratings.length
    ? Number(
        (
          ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
        ).toFixed(2),
      )
    : null;
  return { average, count: ratings.length, breakdown };
}

/** A sub-service's own list wins; an empty one falls back to its main service's list. */
export function ownOrInherited<T>(
  own: T[] | null | undefined,
  inherited: T[] | null | undefined,
): T[] {
  return own && own.length > 0 ? own : (inherited ?? []);
}

/** The steps the app shows when an admin has not written the main service's own "How to order". */
export const DEFAULT_HOW_TO_ORDER = [
  'Select service: pick the service and option you need, then add it to the cart.',
  'Book your schedule: choose a date and a time slot that suits you.',
  'Place order: confirm, and chat with your provider in the order tab.',
];

/** Reviewers are shown by first name only; the rest of a customer's name stays private. */
export function reviewerName(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first || 'Customer';
}

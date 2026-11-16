import { generateOrderReferenceCode } from './order-reference';

describe('generateOrderReferenceCode', () => {
  it('is 6 characters of A-Z and 0-9', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateOrderReferenceCode()).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it('does not repeat in a normal run', () => {
    const codes = new Set(Array.from({ length: 2000 }, generateOrderReferenceCode));
    expect(codes.size).toBe(2000);
  });
});

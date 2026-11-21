import { BadRequestException } from '@nestjs/common';
import { assertNoPhoneNumber, canSeeContactDetails, containsPhoneNumber, maskPhoneNumber, stripContactDetails } from './contact-privacy';

describe('stripContactDetails', () => {
  const order = {
    id: 'o1',
    totalPrice: 2100,
    customer: { id: 'c1', user: { id: 'u-customer', name: 'Alif', mobileNumber: '01711111111', email: 'a@x.com' } },
    provider: { id: 'p1', user: { id: 'u-provider', name: 'Manik', mobileNumber: '01822222222' } },
    technician: null,
  };

  it("removes the other side's number and email, keeps names", () => {
    const seenByProvider = stripContactDetails(order, 'u-provider');
    expect(seenByProvider.customer.user).toEqual({ id: 'u-customer', name: 'Alif' });
  });

  it("keeps the viewer's own number", () => {
    const seenByProvider = stripContactDetails(order, 'u-provider');
    expect(seenByProvider.provider.user.mobileNumber).toBe('01822222222');
  });

  it('removes every number for a guest', () => {
    const seenByGuest = stripContactDetails([order], null);
    expect(JSON.stringify(seenByGuest)).not.toMatch(/0171|0182|@x\.com/);
  });

  it('walks arrays and leaves dates alone', () => {
    const when = new Date();
    const [first] = stripContactDetails([{ id: 'x', when, user: { id: 'y', mobileNumber: '017' } }], 'z');
    expect(first.when).toBe(when);
    expect(first.user).toEqual({ id: 'y' });
  });

  it('lets staff see contact details', () => {
    expect(canSeeContactDetails('ADMIN')).toBe(true);
    expect(canSeeContactDetails('COUNSELOR')).toBe(true);
    expect(canSeeContactDetails('CUSTOMER')).toBe(false);
    expect(canSeeContactDetails('PROVIDER')).toBe(false);
    expect(canSeeContactDetails('TECHNICIAN')).toBe(false);
  });
});

describe('containsPhoneNumber', () => {
  it.each(['call me 01711111111', '+8801711111111', '017 1111 1111', '017-11-11-11-11', '০১৭১১১১১১১১', '(017) 11111111', '+880 1711 111111', '88 017 1111 1111'])('catches %s', (text) => {
    expect(containsPhoneNumber(text)).toBe(true);
  });

  it.each([
    'The AC needs 2 hours',
    'Total ৳3700, paid 3000',
    'order #25486',
    'flat 12, road 5',
    '৳১৫০০ আর ৩০০ আর ২০০০ লাগবে',
    'total 3700 2100 1600 1500 2000',
    'price 100 1500 2000 3000',
    'bill 4300 tip 600 paid 3700',
    'ami 10 30 e ashbo',
  ])('allows %s', (text) => {
    expect(containsPhoneNumber(text)).toBe(false);
  });

  it('assertNoPhoneNumber throws a clear error', () => {
    expect(() => assertNoPhoneNumber('my number 01711111111')).toThrow(BadRequestException);
    expect(() => assertNoPhoneNumber(undefined)).not.toThrow();
  });
});

describe('masked phone for users without a username', () => {
  it('shows the first three and last four digits of the local number', () => {
    expect(maskPhoneNumber('+8801712345678')).toBe('017****5678');
    expect(maskPhoneNumber('01712344585')).toBe('017****4585');
  });

  it('adds maskedPhone only when the user has no username', () => {
    const [noHandle, withHandle] = stripContactDetails(
      [
        { id: 'c1', username: null, mobileNumber: '+8801712345678' },
        { id: 'c2', username: 'rafi', mobileNumber: '+8801812345678' },
      ],
      'provider',
    );
    expect(noHandle).toEqual({ id: 'c1', username: null, maskedPhone: '017****5678' });
    expect(withHandle).toEqual({ id: 'c2', username: 'rafi' });
  });
});

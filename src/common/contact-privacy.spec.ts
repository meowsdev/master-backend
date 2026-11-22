import { BadRequestException } from '@nestjs/common';
import { assertNoPhoneNumber, canSeeContactDetails, canSeeFullPhoneNumbers, containsPhoneNumber, maskPhoneNumber, protectContactDetails } from './contact-privacy';

describe('protectContactDetails', () => {
  const order = {
    id: 'o1',
    totalPrice: 2100,
    customer: { id: 'c1', user: { id: 'u-customer', name: 'Alif', mobileNumber: '01711114585', email: 'a@x.com' } },
    provider: { id: 'p1', user: { id: 'u-provider', name: 'Manik', mobileNumber: '01822222222' } },
    technician: null,
  };

  it("masks the other side's number, drops their email, keeps names", () => {
    const seenByProvider = protectContactDetails(order, 'u-provider');
    expect(seenByProvider.customer.user).toEqual({ id: 'u-customer', name: 'Alif', mobileNumber: '017****4585', maskedPhone: '017****4585' });
  });

  it("keeps the viewer's own number in full", () => {
    const seenByProvider = protectContactDetails(order, 'u-provider');
    expect(seenByProvider.provider.user.mobileNumber).toBe('01822222222');
  });

  it('masks numbers for non-admin staff, but lets them keep emails', () => {
    const seenByAdmin = protectContactDetails(order, 'u-admin', true);
    expect(seenByAdmin.customer.user.mobileNumber).toBe('017****4585');
    expect(seenByAdmin.customer.user.email).toBe('a@x.com');
  });

  it('never lets a full number or email reach a guest', () => {
    const seenByGuest = protectContactDetails([order], null);
    expect(JSON.stringify(seenByGuest)).not.toMatch(/01711114585|01822222222|@x.com/);
  });

  it('walks arrays and leaves dates alone', () => {
    const when = new Date();
    const [first] = protectContactDetails([{ id: 'x', when, user: { id: 'y', mobileNumber: '01711112222' } }], 'z');
    expect(first.when).toBe(when);
    expect(first.user.mobileNumber).toBe('017****2222');
  });

  it('lets only an admin see full numbers', () => {
    expect(canSeeFullPhoneNumbers('ADMIN')).toBe(true);
    for (const role of ['MANAGER', 'SUPPORT', 'HR', 'COUNSELOR', 'CUSTOMER', 'PROVIDER', 'TECHNICIAN']) {
      expect(canSeeFullPhoneNumbers(role)).toBe(false);
    }
  });

  it('lets staff see emails', () => {
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

describe('maskPhoneNumber', () => {
  it('shows the first three and last four digits of the local number', () => {
    expect(maskPhoneNumber('+8801712345678')).toBe('017****5678');
    expect(maskPhoneNumber('01712344585')).toBe('017****4585');
  });
});

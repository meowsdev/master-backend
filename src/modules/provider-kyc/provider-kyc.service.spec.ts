import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  KYC_FILE_DIR,
  isValidNid,
  kycAllowsOrders,
  kycFileOwner,
  normalizeBdMobile,
} from './kyc-rules';
import { ProviderKycService } from './provider-kyc.service';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const key = (owner: string, n: number) =>
  `${owner}_0000000${n}-0000-4000-8000-000000000000.jpg`;
const FILES = [key(USER, 1), key(USER, 2), key(USER, 3), key(OTHER, 4)];

beforeAll(() => {
  mkdirSync(KYC_FILE_DIR, { recursive: true });
  for (const file of FILES) writeFileSync(join(KYC_FILE_DIR, file), 'x');
});
afterAll(() => {
  for (const file of FILES) rmSync(join(KYC_FILE_DIR, file), { force: true });
});

describe('who may get orders', () => {
  const now = new Date('2027-01-10T00:00:00Z');
  it('a verified provider, always', () => {
    expect(
      kycAllowsOrders(
        { kycGraceUntil: null, kyc: { status: 'APPROVED' } },
        now,
      ),
    ).toBe(true);
  });
  it('a provider from before KYC, only until their grace period ends', () => {
    expect(
      kycAllowsOrders(
        { kycGraceUntil: new Date('2027-01-20'), kyc: null },
        now,
      ),
    ).toBe(true);
    expect(
      kycAllowsOrders(
        { kycGraceUntil: new Date('2027-01-01'), kyc: { status: 'PENDING' } },
        now,
      ),
    ).toBe(false);
  });
  it('never a new provider before approval', () => {
    expect(
      kycAllowsOrders({ kycGraceUntil: null, kyc: { status: 'PENDING' } }, now),
    ).toBe(false);
    expect(kycAllowsOrders({ kycGraceUntil: null, kyc: null }, now)).toBe(
      false,
    );
  });
});

describe('form checks', () => {
  it('reads the owner from a file key and refuses anything else', () => {
    expect(kycFileOwner(key(USER, 1))).toBe(USER);
    expect(kycFileOwner('../secret.jpg')).toBeNull();
    expect(kycFileOwner(`${USER}_x.jpg`)).toBeNull();
  });
  it('accepts Bangladeshi mobiles in any common form', () => {
    expect(normalizeBdMobile('01712345678')).toBe('+8801712345678');
    expect(normalizeBdMobile('+880 1712-345678')).toBe('+8801712345678');
    expect(normalizeBdMobile('12345')).toBeNull();
  });
  it('accepts 10, 13 or 17 digit NIDs only', () => {
    expect(
      ['1234567890', '1234567890123', '12345678901234567'].every(isValidNid),
    ).toBe(true);
    expect(isValidNid('12345')).toBe(false);
  });
});

function build(kyc: Record<string, unknown> | null = null, serviceAreas = 1) {
  const prisma = {
    providerProfile: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'pp1',
        kycGraceUntil: null,
        user: { mobileNumber: '+8801700000000', name: null },
        kyc,
        _count: { serviceAreas },
      }),
    },
    providerKyc: {
      upsert: jest.fn().mockReturnValue('upsert'),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({}),
    },
    user: { update: jest.fn().mockReturnValue('user') },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const locations = { isValidLocation: jest.fn().mockReturnValue(true) };
  return {
    service: new ProviderKycService(prisma as never, locations as never),
    prisma,
  };
}

const form = {
  fullName: ' Rahim Uddin ',
  fatherName: 'Abdul Karim',
  motherName: 'Salma Begum',
  gender: 'MALE' as const,
  contactPhone: '01733333333',
  postCode: '1207',
  districtId: 1,
  upazilaId: 9,
  addressDetail: 'House 1, Road 2',
  nidNumber: '1234567890',
  nidFrontKey: key(USER, 1),
  nidBackKey: key(USER, 2),
  selfieKey: key(USER, 3),
  emergencyContacts: [
    { name: 'Karim', relation: 'বাবা', phone: '01811111111' },
    { name: 'Salma', relation: 'মা', phone: '01922222222' },
  ],
};

describe('sending the verification', () => {
  it('saves it as waiting for review, with the family numbers stored as +880, and names a nameless account', async () => {
    const { service, prisma } = build();
    await service.submitMine(USER, form);
    const [[upsert]] = prisma.providerKyc.upsert.mock.calls as [
      [{ create: Record<string, unknown> }],
    ];
    expect(upsert.create).toEqual(
      expect.objectContaining({
        status: 'PENDING',
        fullName: 'Rahim Uddin',
        nidFrontUrl: key(USER, 1),
        emergencyContacts: [
          { name: 'Karim', relation: 'বাবা', phone: '+8801811111111' },
          { name: 'Salma', relation: 'মা', phone: '+8801922222222' },
        ],
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: USER },
      data: { name: 'Rahim Uddin' },
    });
  });

  it("refuses someone else's pictures", async () => {
    await expect(
      build().service.submitMine(USER, { ...form, nidBackKey: key(OTHER, 4) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses the provider's own number or the same number twice as emergency contacts", async () => {
    const own = [
      { name: 'Me', relation: 'নিজে', phone: '01700000000' },
      form.emergencyContacts[0],
    ];
    await expect(
      build().service.submitMine(USER, { ...form, emergencyContacts: own }),
    ).rejects.toThrow('not your own number');
    const twice = [
      form.emergencyContacts[0],
      { ...form.emergencyContacts[0], name: 'Again' },
    ];
    await expect(
      build().service.submitMine(USER, { ...form, emergencyContacts: twice }),
    ).rejects.toThrow('different number');
  });

  it('keeps the personal details, with the contact number stored as +880', async () => {
    const { service, prisma } = build();
    await service.submitMine(USER, form);
    const [[upsert]] = prisma.providerKyc.upsert.mock.calls as [
      [{ create: Record<string, unknown> }],
    ];
    expect(upsert.create).toEqual(
      expect.objectContaining({
        fatherName: 'Abdul Karim',
        motherName: 'Salma Begum',
        gender: 'MALE',
        postCode: '1207',
      }),
    );
  });

  it('always keeps the login number as the phone, whatever the form sends', async () => {
    const { service, prisma } = build();
    await service.submitMine(USER, { ...form, contactPhone: '01999999999' });
    const [[upsert]] = prisma.providerKyc.upsert.mock.calls as [
      [{ create: Record<string, unknown> }],
    ];
    expect(upsert.create.contactPhone).toBe('+8801700000000');
  });

  it('refuses a post code that is not 4 digits', async () => {
    await expect(
      build().service.submitMine(USER, { ...form, postCode: '12' }),
    ).rejects.toThrow('post code');
  });

  it('needs at least one work area first', async () => {
    await expect(build(null, 0).service.submitMine(USER, form)).rejects.toThrow(
      'area',
    );
  });

  it('cannot change an approved verification', async () => {
    await expect(
      build({ status: 'APPROVED' }).service.submitMine(USER, form),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('private pictures', () => {
  it('show to their owner and to an admin, never to another provider', () => {
    const { service } = build();
    expect(
      service.filePath(key(USER, 1), { id: USER, role: 'PROVIDER' }),
    ).toContain(key(USER, 1));
    expect(
      service.filePath(key(USER, 1), { id: 'admin', role: 'ADMIN' }),
    ).toContain(key(USER, 1));
    expect(() =>
      service.filePath(key(USER, 1), { id: OTHER, role: 'PROVIDER' }),
    ).toThrow(ForbiddenException);
  });
});

describe('admin review', () => {
  it('needs a reason to reject', async () => {
    await expect(
      build().service.review('k1', { status: 'REJECTED' }, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only reviews a verification that is waiting', async () => {
    const { service, prisma } = build();
    prisma.providerKyc.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.review('k1', { status: 'APPROVED' }, 'admin'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('a customer applying to be a provider on the same number', () => {
  it('gets a provider side (no orders, no grace) so they can fill in the KYC', async () => {
    const { service, prisma } = build();
    (prisma.providerProfile as Record<string, jest.Mock>).upsert = jest
      .fn()
      .mockResolvedValue({});
    await service.apply(USER);
    expect(
      (prisma.providerProfile as Record<string, jest.Mock>).upsert,
    ).toHaveBeenCalledWith({
      where: { userId: USER },
      create: { userId: USER },
      update: {},
    });
  });
});

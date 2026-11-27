import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';

// The session service pulls in @nestjs/jwt (ESM, which Jest cannot load); switching never touches sessions.
jest.mock('./sessions.service', () => ({ SessionsService: class {} }));

type Profile = {
  kycGraceUntil: Date | null;
  kyc: { status: string } | null;
} | null;

/** One account on `role`, with this provider side (or none). getMe is checked on its own below. */
function build(role: string, providerProfile: Profile) {
  const tx = {
    user: { update: jest.fn() },
    customerProfile: { upsert: jest.fn() },
    providerProfile: { upsert: jest.fn() },
  };
  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'u1', role, providerProfile }),
    },
    providerProfile: {
      findUnique: jest.fn().mockResolvedValue(providerProfile),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const service = new AuthService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  );
  jest.spyOn(service, 'getMe').mockResolvedValue({ id: 'u1' } as never);
  return { service, tx };
}

const approved = { kycGraceUntil: null, kyc: { status: 'APPROVED' } };
const pending = { kycGraceUntil: null, kyc: { status: 'PENDING' } };

describe('Switch Account (one number, customer and provider sides)', () => {
  it('takes a verified customer to their provider side', async () => {
    const { service, tx } = build('CUSTOMER', approved);
    await service.switchProfile('u1', 'PROVIDER');
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'PROVIDER' },
    });
  });

  it('refuses a customer whose KYC is not approved yet, or who never applied', async () => {
    await expect(
      build('CUSTOMER', pending).service.switchProfile('u1', 'PROVIDER'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      build('CUSTOMER', null).service.switchProfile('u1', 'PROVIDER'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a provider from before KYC go back to provider while their grace period lasts', async () => {
    const { service, tx } = build('CUSTOMER', {
      kycGraceUntil: new Date(Date.now() + 86_400_000),
      kyc: null,
    });
    await service.switchProfile('u1', 'PROVIDER');
    expect(tx.user.update).toHaveBeenCalled();
  });

  it('takes any provider to the customer side, making it on first use', async () => {
    const { service, tx } = build('PROVIDER', pending);
    await service.switchProfile('u1', 'CUSTOMER');
    expect(tx.customerProfile.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      update: {},
      create: { userId: 'u1' },
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { role: 'CUSTOMER' },
    });
  });

  it('never moves technicians or staff to another role', async () => {
    await expect(
      build('TECHNICIAN', null).service.switchProfile('u1', 'CUSTOMER'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      build('ADMIN', approved).service.switchProfile('u1', 'PROVIDER'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      build('CUSTOMER', approved).service.switchProfile('u1', 'ADMIN'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does nothing when already on that side', async () => {
    const { service, tx } = build('CUSTOMER', null);
    await service.switchProfile('u1', 'CUSTOMER');
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});

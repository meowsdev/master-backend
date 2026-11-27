import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { OrderExpenseClaimService } from './order-expense-claim.service';

const PROVIDER = { id: 'provider-user', role: 'PROVIDER' };
const TECHNICIAN = { id: 'tech-user', role: 'TECHNICIAN' };
const ADMIN = { id: 'admin-user', role: 'ADMIN' };

type Claim = {
  id: string;
  orderId: string;
  status: string;
  isFromTechnician: boolean;
  history: unknown[];
  items: unknown[];
};

/** A finished ৳5000 cash job with a technician, and one claim in `claim`'s state. */
function build(
  claim: Partial<Claim> = {},
  orderOverrides: Record<string, unknown> = {},
) {
  const order = {
    id: 'o1',
    totalPrice: 5000,
    adminCommission: 500,
    commissionRate: 10,
    completedAt: new Date('2026-11-21T10:00:00Z'),
    providerId: 'pp1',
    provider: { userId: PROVIDER.id },
    technician: { userId: TECHNICIAN.id },
    paymentAndTip: { paymentMode: 'CASH' },
    revisions: [],
    ...orderOverrides,
  };
  const stored: Claim = {
    id: 'c1',
    orderId: 'o1',
    status: 'PROVIDER_REVIEW',
    isFromTechnician: true,
    history: [],
    items: [{ label: 'Capacitor', amount: 1200 }],
    ...claim,
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    extraChargeRequest: { count: jest.fn().mockResolvedValue(0) },
    orderExpenseClaim: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn().mockResolvedValue({ _sum: { approvedTotal: 0 } }),
      findUnique: jest.fn().mockResolvedValue(stored),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'c1' }),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: unknown }) =>
          Promise.resolve(data),
        ),
    },
  };
  const moved = () =>
    (
      prisma.orderExpenseClaim.updateMany.mock.calls[0] as [
        { where: { status: string }; data: Record<string, unknown> },
      ]
    )[0];
  return {
    service: new OrderExpenseClaimService(prisma as never),
    prisma,
    moved,
  };
}

const items = [{ label: 'Capacitor', amount: 1500 }];

describe('who a new claim goes to', () => {
  it("sends the technician's costs to the provider first", async () => {
    const { service } = build();
    await expect(
      service.submit('o1', { items }, TECHNICIAN),
    ).resolves.toMatchObject({
      status: 'PROVIDER_REVIEW',
      isFromTechnician: true,
    });
  });

  it("sends the provider's own costs straight to the admin", async () => {
    const { service } = build();
    await expect(
      service.submit('o1', { items }, PROVIDER),
    ).resolves.toMatchObject({ status: 'PENDING', isFromTechnician: false });
  });

  it('allows no new claim while one is with the provider or the technician', async () => {
    const { service, prisma } = build();
    prisma.orderExpenseClaim.count.mockResolvedValue(1);
    await expect(
      service.submit('o1', { items }, TECHNICIAN),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.orderExpenseClaim.count).toHaveBeenCalledWith({
      where: {
        orderId: 'o1',
        status: {
          in: ['PENDING', 'PROVIDER_REVIEW', 'RETURNED_TO_TECHNICIAN'],
        },
      },
    });
  });
});

describe('the provider reviewing', () => {
  it('changes the amounts, accepts and passes them to the admin, keeping the step in the history', async () => {
    const { service, moved } = build();
    await service.providerAccept(
      'c1',
      { items, note: 'Market price' },
      PROVIDER,
    );
    expect(moved().where.status).toBe('PROVIDER_REVIEW');
    expect(moved().data).toEqual(
      expect.objectContaining({
        status: 'PENDING',
        items,
        claimedTotal: 1500,
        providerNote: 'Market price',
      }),
    );
    expect(moved().data.history).toEqual([
      expect.objectContaining({
        action: 'PROVIDER_ACCEPTED',
        byRole: 'PROVIDER',
        total: 1500,
      }),
    ]);
  });

  it("sends the technician's costs back to them", async () => {
    const { service, moved } = build();
    await service.providerReturn('c1', 'Wrong price', PROVIDER);
    expect(moved().data).toEqual(
      expect.objectContaining({
        status: 'RETURNED_TO_TECHNICIAN',
        providerNote: 'Wrong price',
      }),
    );
  });

  it('cannot send back costs they sent themselves (there is no technician step)', async () => {
    const { service } = build({ isFromTechnician: false });
    await expect(
      service.providerReturn('c1', 'x', PROVIDER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is only for the provider of the order, and only while it waits for them', async () => {
    await expect(
      build().service.providerAccept('c1', { items }, TECHNICIAN),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      build({ status: 'PENDING' }).service.providerAccept(
        'c1',
        { items },
        PROVIDER,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cannot go above the bill', async () => {
    const { service } = build();
    await expect(
      service.providerAccept(
        'c1',
        { items: [{ label: 'Parts', amount: 6000 }] },
        PROVIDER,
      ),
    ).rejects.toThrow('more than the order total');
  });
});

describe('the technician sending again', () => {
  it('changes the amounts and sends them to the provider again', async () => {
    const { service, moved } = build({ status: 'RETURNED_TO_TECHNICIAN' });
    await service.resubmit('c1', { items }, TECHNICIAN);
    expect(moved().data).toEqual(
      expect.objectContaining({
        status: 'PROVIDER_REVIEW',
        items,
        claimedTotal: 1500,
      }),
    );
  });

  it('only for the technician of the order, and only once it was sent back', async () => {
    await expect(
      build({ status: 'RETURNED_TO_TECHNICIAN' }).service.resubmit(
        'c1',
        { items },
        PROVIDER,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      build({ status: 'PROVIDER_REVIEW' }).service.resubmit(
        'c1',
        { items },
        TECHNICIAN,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('the admin sending it back', () => {
  it('returns it to the provider with the amounts the admin thinks are right', async () => {
    const { service, moved } = build({ status: 'PENDING' });
    await service.reject(
      'c1',
      { note: 'Too high', items: [{ label: 'Capacitor', amount: 900 }] },
      ADMIN,
    );
    expect(moved().where.status).toBe('PENDING');
    expect(moved().data).toEqual(
      expect.objectContaining({
        status: 'PROVIDER_REVIEW',
        claimedTotal: 900,
        reviewNote: 'Too high',
        reviewedById: ADMIN.id,
      }),
    );
    expect(moved().data.history).toEqual([
      expect.objectContaining({
        action: 'ADMIN_RETURNED',
        byRole: 'ADMIN',
        total: 900,
      }),
    ]);
  });

  it('keeps the amounts when the admin only writes a note', async () => {
    const { service, moved } = build({ status: 'PENDING' });
    await service.reject('c1', { note: 'Send a receipt' }, ADMIN);
    expect(moved().data.items).toBeUndefined();
    expect(moved().data.status).toBe('PROVIDER_REVIEW');
  });

  it('cannot send back a claim that is not waiting for the admin', async () => {
    await expect(
      build({ status: 'PROVIDER_REVIEW' }).service.reject('c1', {}, ADMIN),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

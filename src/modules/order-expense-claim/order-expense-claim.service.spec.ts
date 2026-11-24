import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrderExpenseClaimService, commissionAfterExpenses } from './order-expense-claim.service';

const PROVIDER = { id: 'provider-user', role: 'PROVIDER' };
const TECHNICIAN = { id: 'tech-user', role: 'TECHNICIAN' };
const ADMIN = { id: 'admin-user', role: 'ADMIN' };

interface Setup {
  /** Claims waiting for review. */
  pending?: number;
  /** The latest approved claim, if any. */
  lastApproved?: { reviewedAt: Date; createdAt: Date } | null;
  /** Costs approved by earlier claims, added up. */
  approvedSoFar?: number;
  /** Extra charges approved after the latest approved claim (a revision billed more work). */
  extrasSince?: number;
  /** An online job settled since online money reaches the wallet has a credit; an older one has none. */
  walletCredits?: number;
}

function build(orderOverrides: Record<string, unknown> = {}, { pending = 0, lastApproved = null, approvedSoFar = 0, extrasSince = 0, walletCredits = 0 }: Setup = {}) {
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
  const tx = {
    orderExpenseClaim: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'c1' }) },
    order: { update: jest.fn() },
    providerProfile: { update: jest.fn().mockResolvedValue({ walletBalance: 200 }) },
    // An online job's credit still in its clearance period (none for a cash job).
    walletCredit: { findFirst: jest.fn().mockResolvedValue(walletCredits > 0 ? { id: 'credit1' } : null), update: jest.fn() },
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    walletCredit: { count: jest.fn().mockResolvedValue(walletCredits) },
    extraChargeRequest: { count: jest.fn().mockResolvedValue(extrasSince) },
    orderExpenseClaim: {
      count: jest.fn().mockResolvedValue(pending),
      findFirst: jest.fn().mockResolvedValue(lastApproved),
      aggregate: jest.fn().mockResolvedValue({ _sum: { approvedTotal: approvedSoFar } }),
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', orderId: 'o1' }),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { service: new OrderExpenseClaimService(prisma as never), tx, prisma };
}

const parts = { items: [{ label: '  Capacitor  ', amount: 1200 }, { label: 'Gas', amount: 800 }] };

describe('commission after costs', () => {
  it('takes the order rate (10%) of total minus costs', () => {
    expect(commissionAfterExpenses({ totalPrice: 5000, commissionRate: 10 }, 2000)).toBe(300);
  });

  it("uses the provider's own percent: ৳5000 job, ৳2000 parts, 30% → ৳900", () => {
    expect(commissionAfterExpenses({ totalPrice: 5000, commissionRate: 30 }, 2000)).toBe(900);
  });

  it('never goes below zero', () => {
    expect(commissionAfterExpenses({ totalPrice: 5000, commissionRate: 30 }, 5000)).toBe(0);
  });
});

describe('sending costs', () => {
  it('lets the provider or the technician send them after the job is complete', async () => {
    for (const actor of [PROVIDER, TECHNICIAN]) {
      const { service } = build();
      const claim = await service.submit('o1', parts, actor);
      expect(claim).toMatchObject({ claimedTotal: 2000, items: [{ label: 'Capacitor', amount: 1200 }, { label: 'Gas', amount: 800 }] });
    }
  });

  it('turns away the customer and anyone else', async () => {
    const { service } = build();
    await expect(service.submit('o1', parts, { id: 'customer', role: 'CUSTOMER' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('waits until the work is complete', async () => {
    const { service } = build({ completedAt: null });
    await expect(service.submit('o1', parts, PROVIDER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is closed while a revision is open', async () => {
    const { service, prisma } = build({ revisions: [{ id: 'r1' }] });
    await expect(service.submit('o1', parts, PROVIDER)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.orderExpenseClaim.create).not.toHaveBeenCalled();
  });

  const approvedAt = new Date('2026-11-22T10:00:00Z');

  it('allows one claim under review, and none after an approval while nothing new was billed', async () => {
    await expect(build({}, { pending: 1 }).service.submit('o1', parts, PROVIDER)).rejects.toBeInstanceOf(ConflictException);
    const { service, prisma } = build({}, { lastApproved: { reviewedAt: approvedAt, createdAt: approvedAt } });
    await expect(service.submit('o1', parts, PROVIDER)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.extraChargeRequest.count).toHaveBeenCalledWith({ where: expect.objectContaining({ orderId: 'o1', status: 'APPROVED', createdAt: { gt: approvedAt } }) });
  });

  it('opens again once a revision billed extra work, for the parts of that work', async () => {
    const { service } = build({ totalPrice: 7000 }, { lastApproved: { reviewedAt: approvedAt, createdAt: approvedAt }, approvedSoFar: 2000, extrasSince: 1 });
    await expect(service.submit('o1', parts, PROVIDER)).resolves.toMatchObject({ claimedTotal: 2000 });
  });

  it('keeps all costs together within the bill', async () => {
    const { service } = build({}, { lastApproved: { reviewedAt: approvedAt, createdAt: approvedAt }, approvedSoFar: 4000, extrasSince: 1 });
    await expect(service.submit('o1', parts, PROVIDER)).rejects.toThrow('more than the order total');
  });

  it('tells the app whether costs can be sent', async () => {
    await expect(build().service.status('o1', PROVIDER)).resolves.toEqual({ canSubmit: true, reason: null, approvedCosts: 0 });
    await expect(build({}, { lastApproved: { reviewedAt: approvedAt, createdAt: approvedAt }, approvedSoFar: 2000 }).service.status('o1', ADMIN)).resolves.toEqual({
      canSubmit: false,
      reason: 'The costs of this order are already approved',
      approvedCosts: 2000,
    });
  });
});

describe('admin approval', () => {
  const reviewed = { items: [{ label: 'Capacitor', amount: 1000 }, { label: 'Gas', amount: 1000 }], note: 'checked' };

  it("takes a revision's parts out of its extra work the same way, at the provider's percent", async () => {
    // ৳5000 job at 30% with ৳2000 parts approved: commission 30% of 3000 = 900. The revision billed ৳2000
    // extra (+600 commission → 1500 on a ৳7000 bill) and used ৳500 of parts.
    const { service, tx } = build({ totalPrice: 7000, adminCommission: 1500, commissionRate: 30 }, { approvedSoFar: 2000 });
    await service.approve('c1', { items: [{ label: 'Valve', amount: 500 }] }, ADMIN);
    // 30% of (7000 − 2000 − 500) = 1350: the extra work is commissioned on its profit too (2000 − 500 = 1500 → 450).
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { adminCommission: 1350 } });
    expect(tx.providerProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { walletBalance: { increment: 150 } } }));
  });

  it('refuses approved costs that with the earlier ones exceed the bill', async () => {
    const { service } = build({}, { approvedSoFar: 4500 });
    await expect(service.approve('c1', reviewed, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lowers the commission to the rate of (total - approved costs) and gives a cash job the difference back', async () => {
    const { service, tx } = build();
    await service.approve('c1', reviewed, ADMIN);
    expect(tx.orderExpenseClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'APPROVED', approvedTotal: 2000, commissionBefore: 500, commissionAfter: 300, reviewedById: ADMIN.id }),
    }));
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { adminCommission: 300 } });
    expect(tx.providerProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { walletBalance: { increment: 200 } } }));
  });

  it('only changes the commission of an online job settled before wallet credits (the platform kept it)', async () => {
    const { service, tx } = build({ paymentAndTip: { paymentMode: 'BKASH' } });
    await service.approve('c1', reviewed, ADMIN);
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { adminCommission: 300 } });
    expect(tx.providerProfile.update).not.toHaveBeenCalled();
  });

  it('refunds the commission difference to the wallet of an online job whose commission left the wallet', async () => {
    const { service, tx } = build({ paymentAndTip: { paymentMode: 'BKASH' } }, { walletCredits: 1 });
    await service.approve('c1', reviewed, ADMIN);
    expect(tx.providerProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { walletBalance: { increment: 200 } } }));
  });

  it("holds the refunded commission of an online job with the rest of its money until clearance", async () => {
    // ৳6000 job paid by bKash: credit 6400 clearing. ৳2000 of parts approved → ৳200 back, which must clear with it.
    const { service, tx } = build({ paymentAndTip: { paymentMode: 'BKASH' } }, { walletCredits: 1 });
    await service.approve('c1', reviewed, ADMIN);
    expect(tx.walletCredit.update).toHaveBeenCalledWith({ where: { id: 'credit1' }, data: { amount: { increment: 200 } } });
  });

  it('adds nothing to clearance for a cash job: the refund only lowers its due', async () => {
    const { service, tx } = build();
    await service.approve('c1', reviewed, ADMIN);
    expect(tx.walletCredit.update).not.toHaveBeenCalled();
  });

  it('refuses costs above the order total', async () => {
    const { service } = build();
    await expect(service.approve('c1', { items: [{ label: 'Parts', amount: 6000 }] }, ADMIN)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies a claim once even on a double click', async () => {
    const { service, tx } = build();
    tx.orderExpenseClaim.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.approve('c1', reviewed, ADMIN)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});

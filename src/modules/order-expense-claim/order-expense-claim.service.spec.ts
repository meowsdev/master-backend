import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrderExpenseClaimService, commissionAfterExpenses } from './order-expense-claim.service';

const PROVIDER = { id: 'provider-user', role: 'PROVIDER' };
const TECHNICIAN = { id: 'tech-user', role: 'TECHNICIAN' };
const ADMIN = { id: 'admin-user', role: 'ADMIN' };

function build(orderOverrides: Record<string, unknown> = {}, existingClaim: { status: string } | null = null, walletCredits = 0) {
  const order = {
    id: 'o1',
    totalPrice: 5000,
    adminCommission: 500,
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
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    // An online job settled since online money reaches the wallet has a credit; an older one has none.
    walletCredit: { count: jest.fn().mockResolvedValue(walletCredits) },
    orderExpenseClaim: {
      findFirst: jest.fn().mockResolvedValue(existingClaim),
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
    expect(commissionAfterExpenses({ totalPrice: 5000, adminCommission: 500 }, 2000)).toBe(300);
  });

  it('keeps a custom rate an admin set on the order', () => {
    expect(commissionAfterExpenses({ totalPrice: 5000, adminCommission: 750 }, 2000)).toBe(450);
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

  it('allows one claim under review and none after an approval', async () => {
    await expect(build({}, { status: 'PENDING' }).service.submit('o1', parts, PROVIDER)).rejects.toBeInstanceOf(ConflictException);
    await expect(build({}, { status: 'APPROVED' }).service.submit('o1', parts, PROVIDER)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('admin approval', () => {
  const reviewed = { items: [{ label: 'Capacitor', amount: 1000 }, { label: 'Gas', amount: 1000 }], note: 'checked' };

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
    const { service, tx } = build({ paymentAndTip: { paymentMode: 'BKASH' } }, null, 1);
    await service.approve('c1', reviewed, ADMIN);
    expect(tx.providerProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { walletBalance: { increment: 200 } } }));
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

import { AdminEarningsService } from './admin-earnings.service';

const NOW = new Date(2026, 10, 24, 12);

const order = (providerId: string, completedAt: Date, totalPrice: number, adminCommission: number, payment: { paymentMode: string; tipAmount: number } | null) => ({
  providerId,
  totalPrice,
  adminCommission,
  completedAt,
  updatedAt: completedAt,
  paymentAndTip: payment,
});

function build() {
  const prisma = {
    order: {
      findMany: jest.fn().mockResolvedValue([
        // A 30% partner: ৳5000 job with ৳2000 parts approved → ৳900.
        order('p1', new Date(2026, 10, 5), 5000, 900, { paymentMode: 'CASH', tipAmount: 100 }),
        order('p1', new Date(2026, 9, 12), 2000, 600, { paymentMode: 'BKASH', tipAmount: 0 }),
        order('p2', new Date(2026, 10, 20), 1000, 100, null),
      ]),
      aggregate: jest.fn().mockResolvedValue({ _count: 3, _sum: { totalPrice: 4000, adminCommission: 450 } }),
    },
    providerProfile: {
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({ _count: 2, _sum: { walletBalance: -1300 } })
        .mockResolvedValueOnce({ _count: 1, _sum: { walletBalance: 2500 } }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'p1', companyName: 'Cool Fix', commissionRate: 30, walletBalance: 2500, user: { id: 'u1', name: 'Rahim', username: null, mobileNumber: '01711111111' } },
        { id: 'p2', companyName: null, commissionRate: 10, walletBalance: -100, user: { id: 'u2', name: 'Karim', username: null, mobileNumber: '01722222222' } },
      ]),
    },
    withdrawalRequest: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'PENDING', _count: 1, _sum: { amount: 1000 } },
        { status: 'PAID', _count: 4, _sum: { amount: 8000 } },
      ]),
    },
    orderExpenseClaim: { findMany: jest.fn().mockResolvedValue([{ approvedTotal: 2000, commissionBefore: 1500, commissionAfter: 900 }]) },
  };
  return new AdminEarningsService(prisma as never);
}

describe('AdminEarningsService', () => {
  it("adds up the platform's commission from completed orders", async () => {
    const { summary } = await build().report(NOW);
    expect(summary).toMatchObject({
      commissionTotal: 1600,
      thisMonth: 1000,
      lastMonth: 600,
      completedOrders: 3,
      billedTotal: 8000,
      averageCommissionPercent: 20,
      // No payment record counts as cash.
      cashCommission: 1000,
      onlineCommission: 600,
      partnerTips: 100,
      expectedCommission: 450,
      activeOrders: 3,
      approvedCosts: 2000,
      commissionReducedByCosts: 600,
    });
  });

  it('shows what partners owe and what is owed to them', async () => {
    const { wallets } = await build().report(NOW);
    expect(wallets).toEqual({
      duesReceivable: 1300,
      partnersWithDue: 2,
      partnerBalances: 2500,
      partnersWithBalance: 1,
      pendingWithdrawals: 1000,
      pendingWithdrawalCount: 1,
      paidOut: 8000,
    });
  });

  it('lists the last six months oldest first', async () => {
    const { monthly } = await build().report(NOW);
    expect(monthly.map((row) => row.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(monthly[5]).toEqual({ month: '2026-11', orders: 2, billed: 6000, commission: 1000 });
  });

  it('breaks the commission down per partner, highest first', async () => {
    const { partners } = await build().report(NOW);
    expect(partners.map((row) => row.name)).toEqual(['Cool Fix', 'Karim']);
    expect(partners[0]).toMatchObject({ userId: 'u1', orders: 2, billed: 7000, commission: 1500, thisMonth: 900, commissionRate: 30, walletBalance: 2500 });
  });
});

import { NotFoundException } from '@nestjs/common';
import { ProviderEarningsService } from './provider-earnings.service';

const NOW = new Date(2026, 10, 24, 12);

function order(id: string, completedAt: Date, totalPrice: number, adminCommission: number, payment: { paymentMode: string; tipAmount: number } | null) {
  return { id, referenceCode: id.toUpperCase(), totalPrice, adminCommission, commissionRate: 10, completedAt, updatedAt: completedAt, service: { name: 'AC servicing' }, paymentAndTip: payment };
}

function build(walletBalance = -150) {
  const prisma = {
    providerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', walletBalance }) },
    order: {
      findMany: jest.fn().mockResolvedValue([
        order('a', new Date(2026, 10, 3), 2000, 200, { paymentMode: 'CASH', tipAmount: 100 }),
        order('b', new Date(2026, 10, 20), 1000, 150, { paymentMode: 'BKASH', tipAmount: 0 }),
        order('c', new Date(2026, 9, 10), 500, 50, null),
        // Older than the six months shown: counts in the totals, not in the monthly rows.
        order('d', new Date(2025, 0, 5), 800, 80, { paymentMode: 'CASH', tipAmount: 0 }),
      ]),
      aggregate: jest.fn().mockResolvedValue({ _count: 2, _sum: { totalPrice: 3000, adminCommission: 300 } }),
    },
  };
  const withdrawals = { balance: jest.fn().mockResolvedValue({ availableForWithdrawal: 0, pendingClearance: 0, pendingWithdrawal: 0, withdrawn: 0, minWithdrawal: 500 }) };
  return { service: new ProviderEarningsService(prisma as never, withdrawals as never), prisma, withdrawals };
}

describe('ProviderEarningsService', () => {
  it('adds up income as bill minus commission plus tip', async () => {
    const { service } = build();
    const { summary } = await service.earnings('user-1', NOW);
    // a: 1900, b: 850, c: 450, d: 720
    expect(summary.netIncome).toBe(3920);
    expect(summary.thisMonth).toBe(2750);
    expect(summary.lastMonth).toBe(450);
    expect(summary.completedOrders).toBe(4);
    expect(summary.averageOrderValue).toBe(1075);
    expect(summary.tips).toBe(100);
    expect(summary.commissionPaid).toBe(480);
    // No payment record counts as cash (closed on site).
    expect(summary.cashIncome).toBe(3070);
    expect(summary.onlineIncome).toBe(850);
    expect(summary.expectedEarnings).toBe(2700);
    expect(summary.activeOrders).toBe(2);
    expect(summary.dueAmount).toBe(150);
  });

  it('adds the withdraw card from the wallet', async () => {
    const { service, withdrawals } = build(900);
    const result = await service.earnings('user-1', NOW);
    expect(withdrawals.balance).toHaveBeenCalledWith('p1', 900, NOW);
    expect(result.wallet).toMatchObject({ balance: 900, minWithdrawal: 500 });
  });

  it('shows the last six months oldest first, empty months included', async () => {
    const { service } = build();
    const { monthly } = await service.earnings('user-1', NOW);
    expect(monthly.map((row) => row.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(monthly[0]).toMatchObject({ orders: 0, net: 0 });
    expect(monthly[5]).toMatchObject({ orders: 2, billed: 3000, commission: 350, tips: 100, net: 2750 });
  });

  it('lists the newest jobs first', async () => {
    const { service } = build(500);
    const result = await service.earnings('user-1', NOW);
    expect(result.transactions.map((row) => row.referenceCode)).toEqual(['B', 'A', 'C', 'D']);
    expect(result.transactions[0]).toMatchObject({ paymentMode: 'ONLINE', net: 850 });
    expect(result.summary.dueAmount).toBe(0);
  });

  it('refuses someone without a provider profile', async () => {
    const { service, prisma } = build();
    prisma.providerProfile.findUnique.mockResolvedValue(null);
    await expect(service.earnings('user-1', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });
});

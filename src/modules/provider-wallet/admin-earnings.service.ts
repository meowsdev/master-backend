import { Injectable } from '@nestjs/common';
import { ExpenseClaimStatus, OrderStatus, PaymentMode, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { effectiveCommissionRate, readPlatformOrderCommission } from '../orders/orders.helpers';

/** Months shown in the monthly breakdown, this month included. */
const MONTHS_SHOWN = 6;
/** Partners listed, highest commission first. */
const PARTNERS_SHOWN = 50;
const ACTIVE_STATUSES: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS];

const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/**
 * The platform's earnings page (admin). The platform earns the commission of every completed order (after
 * approved parts / costs and revision extras, as the order's adminCommission holds it). Cash jobs: partners
 * collected the money and owe the commission (their due). Online jobs: the platform received the money and owes
 * partners their share (their positive balance), paid out through withdrawals.
 */
@Injectable()
export class AdminEarningsService {
  constructor(private readonly prisma: PrismaService) {}

  async report(now = new Date()) {
    const [completed, active, negative, positive, withdrawals, claims] = await Promise.all([
      this.prisma.order.findMany({
        where: { orderStatus: OrderStatus.COMPLETED },
        select: { providerId: true, totalPrice: true, adminCommission: true, completedAt: true, updatedAt: true, paymentAndTip: { select: { paymentMode: true, tipAmount: true } } },
      }),
      this.prisma.order.aggregate({
        where: { orderStatus: { in: ACTIVE_STATUSES }, isPricePending: false },
        _count: true,
        _sum: { totalPrice: true, adminCommission: true },
      }),
      this.prisma.providerProfile.aggregate({ where: { walletBalance: { lt: 0 } }, _sum: { walletBalance: true }, _count: true }),
      this.prisma.providerProfile.aggregate({ where: { walletBalance: { gt: 0 } }, _sum: { walletBalance: true }, _count: true }),
      this.prisma.withdrawalRequest.groupBy({ by: ['status'], _sum: { amount: true }, _count: true }),
      this.prisma.orderExpenseClaim.findMany({ where: { status: ExpenseClaimStatus.APPROVED }, select: { approvedTotal: true, commissionBefore: true, commissionAfter: true } }),
    ]);

    const rows = completed.map((order) => ({
      providerId: order.providerId,
      billed: Number(order.totalPrice),
      commission: Number(order.adminCommission),
      tip: Number(order.paymentAndTip?.tipAmount ?? 0),
      isCash: (order.paymentAndTip?.paymentMode ?? PaymentMode.CASH) === PaymentMode.CASH,
      // An order completed before completedAt was recorded falls back to its last change.
      month: monthKey(order.completedAt ?? order.updatedAt),
    }));
    type Row = (typeof rows)[number];
    const sum = (items: Row[], pick: (row: Row) => number) => items.reduce((total, row) => total + pick(row), 0);

    const months = Array.from({ length: MONTHS_SHOWN }, (_, index) => monthKey(new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1 - index), 1)));
    const monthly = months.map((month) => {
      const inMonth = rows.filter((row) => row.month === month);
      return { month, orders: inMonth.length, billed: sum(inMonth, (row) => row.billed), commission: sum(inMonth, (row) => row.commission) };
    });

    const billedTotal = sum(rows, (row) => row.billed);
    const commissionTotal = sum(rows, (row) => row.commission);
    const withdrawalBy = (status: WithdrawalStatus) => withdrawals.find((row) => row.status === status);

    return {
      summary: {
        commissionTotal,
        thisMonth: monthly[MONTHS_SHOWN - 1].commission,
        lastMonth: monthly[MONTHS_SHOWN - 2].commission,
        completedOrders: rows.length,
        // Gross order value: everything customers were billed on completed orders.
        billedTotal,
        averageCommissionPercent: billedTotal > 0 ? Math.round((commissionTotal / billedTotal) * 10000) / 100 : 0,
        cashCommission: sum(rows.filter((row) => row.isCash), (row) => row.commission),
        onlineCommission: sum(rows.filter((row) => !row.isCash), (row) => row.commission),
        // Tips go to partners in full; shown for the record.
        partnerTips: sum(rows, (row) => row.tip),
        // Taken and priced orders not finished yet: the commission they should bring.
        expectedCommission: Number(active._sum.adminCommission ?? 0),
        activeOrders: active._count,
        // Parts / costs approved on jobs, and the commission given up for them.
        approvedCosts: claims.reduce((total, claim) => total + Number(claim.approvedTotal ?? 0), 0),
        commissionReducedByCosts: claims.reduce((total, claim) => total + (Number(claim.commissionBefore ?? 0) - Number(claim.commissionAfter ?? 0)), 0),
      },
      wallets: {
        // Owed to the platform: cash jobs' commission partners have not paid yet.
        duesReceivable: -Number(negative._sum.walletBalance ?? 0),
        partnersWithDue: negative._count,
        // Owed to partners: their share of online money, still in their balance (clearing or withdrawable).
        partnerBalances: Number(positive._sum.walletBalance ?? 0),
        partnersWithBalance: positive._count,
        pendingWithdrawals: Number(withdrawalBy(WithdrawalStatus.PENDING)?._sum.amount ?? 0),
        pendingWithdrawalCount: withdrawalBy(WithdrawalStatus.PENDING)?._count ?? 0,
        paidOut: Number(withdrawalBy(WithdrawalStatus.PAID)?._sum.amount ?? 0),
      },
      monthly,
      partners: await this.partnerBreakdown(rows, now),
    };
  }

  /** Commission per partner, highest first, with their rate and wallet. */
  private async partnerBreakdown(rows: Array<{ providerId: string; billed: number; commission: number; month: string }>, now: Date) {
    const thisMonth = monthKey(now);
    const byProvider = new Map<string, { orders: number; billed: number; commission: number; thisMonth: number }>();
    for (const row of rows) {
      const entry = byProvider.get(row.providerId) ?? { orders: 0, billed: 0, commission: 0, thisMonth: 0 };
      entry.orders += 1;
      entry.billed += row.billed;
      entry.commission += row.commission;
      if (row.month === thisMonth) entry.thisMonth += row.commission;
      byProvider.set(row.providerId, entry);
    }
    const top = [...byProvider.entries()].sort((a, b) => b[1].commission - a[1].commission).slice(0, PARTNERS_SHOWN);
    const profiles = await this.prisma.providerProfile.findMany({
      where: { id: { in: top.map(([id]) => id) } },
      select: { id: true, companyName: true, commissionRate: true, walletBalance: true, user: { select: { id: true, name: true, username: true, mobileNumber: true } } },
    });
    const profileOf = new Map(profiles.map((profile) => [profile.id, profile]));
    const globalRate = await readPlatformOrderCommission(this.prisma);

    return top.flatMap(([providerId, totals]) => {
      const profile = profileOf.get(providerId);
      if (!profile) return [];
      return [{
        providerId,
        userId: profile.user.id,
        name: profile.companyName || profile.user.name || profile.user.username || profile.user.mobileNumber,
        mobileNumber: profile.user.mobileNumber,
        commissionRate: effectiveCommissionRate(profile.commissionRate, globalRate),
        walletBalance: Number(profile.walletBalance),
        ...totals,
      }];
    });
  }
}

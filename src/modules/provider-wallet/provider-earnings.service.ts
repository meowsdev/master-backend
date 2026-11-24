import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Months shown in the monthly breakdown, this month included. */
const MONTHS_SHOWN = 6;
/** Most recent completed orders listed as transactions. */
const TRANSACTIONS_SHOWN = 30;
/** Taken but not finished yet: their income is still to come. */
const ACTIVE_STATUSES: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS];

const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/**
 * The provider's earnings page. A job's income is its bill minus the platform's commission, plus the tip.
 * Cash jobs: the provider collected the money and owes the commission (the wallet due). Online jobs: the
 * platform received the money.
 */
@Injectable()
export class ProviderEarningsService {
  constructor(private readonly prisma: PrismaService) {}

  async earnings(userId: string, now = new Date()) {
    const provider = await this.prisma.providerProfile.findUnique({ where: { userId }, select: { id: true, walletBalance: true } });
    if (!provider) throw new NotFoundException('Provider profile not found');

    const [completed, active] = await Promise.all([
      this.prisma.order.findMany({
        where: { providerId: provider.id, orderStatus: OrderStatus.COMPLETED },
        select: {
          id: true,
          referenceCode: true,
          totalPrice: true,
          adminCommission: true,
          commissionRate: true,
          completedAt: true,
          updatedAt: true,
          service: { select: { name: true } },
          paymentAndTip: { select: { paymentMode: true, tipAmount: true } },
        },
      }),
      this.prisma.order.aggregate({
        where: { providerId: provider.id, orderStatus: { in: ACTIVE_STATUSES }, isPricePending: false },
        _count: true,
        _sum: { totalPrice: true, adminCommission: true },
      }),
    ]);

    const rows = completed
      .map((order) => {
        const billed = Number(order.totalPrice);
        const commission = Number(order.adminCommission);
        const tip = Number(order.paymentAndTip?.tipAmount ?? 0);
        const paymentMode = order.paymentAndTip?.paymentMode ?? PaymentMode.CASH;
        return {
          orderId: order.id,
          referenceCode: order.referenceCode,
          serviceName: order.service.name,
          // An order completed before completedAt was recorded falls back to its last change.
          completedAt: order.completedAt ?? order.updatedAt,
          billed,
          commission,
          commissionRate: Number(order.commissionRate),
          tip,
          net: billed - commission + tip,
          isCash: paymentMode === PaymentMode.CASH,
        };
      })
      .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());

    const sum = (items: typeof rows, pick: (row: (typeof rows)[number]) => number) => items.reduce((total, row) => total + pick(row), 0);

    // The last MONTHS_SHOWN months, oldest first, each with its totals (zero when nothing was completed).
    const months = Array.from({ length: MONTHS_SHOWN }, (_, index) => monthKey(new Date(now.getFullYear(), now.getMonth() - (MONTHS_SHOWN - 1 - index), 1)));
    const monthly = months.map((month) => {
      const inMonth = rows.filter((row) => monthKey(row.completedAt) === month);
      return {
        month,
        orders: inMonth.length,
        billed: sum(inMonth, (row) => row.billed),
        commission: sum(inMonth, (row) => row.commission),
        tips: sum(inMonth, (row) => row.tip),
        net: sum(inMonth, (row) => row.net),
      };
    });

    const billedTotal = sum(rows, (row) => row.billed);
    const balance = Number(provider.walletBalance);
    const cashRows = rows.filter((row) => row.isCash);
    const onlineRows = rows.filter((row) => !row.isCash);

    return {
      summary: {
        netIncome: sum(rows, (row) => row.net),
        thisMonth: monthly[MONTHS_SHOWN - 1].net,
        lastMonth: monthly[MONTHS_SHOWN - 2].net,
        completedOrders: rows.length,
        averageOrderValue: rows.length > 0 ? Math.round(billedTotal / rows.length) : 0,
        tips: sum(rows, (row) => row.tip),
        commissionPaid: sum(rows, (row) => row.commission),
        cashIncome: sum(cashRows, (row) => row.net),
        onlineIncome: sum(onlineRows, (row) => row.net),
        // Jobs taken and priced but not finished: what they should bring in after commission.
        expectedEarnings: Number(active._sum.totalPrice ?? 0) - Number(active._sum.adminCommission ?? 0),
        activeOrders: active._count,
        // A negative wallet is what the provider owes the platform.
        dueAmount: balance < 0 ? -balance : 0,
      },
      monthly,
      transactions: rows.slice(0, TRANSACTIONS_SHOWN).map((row) => ({ ...row, paymentMode: row.isCash ? 'CASH' : 'ONLINE' })),
    };
  }
}

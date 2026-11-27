import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

export const ORDER_RELATIONS_INCLUDE = {
  // The "created by" tag every role sees: the name only, never the creator's number.
  createdBy: { select: { name: true } },
  // Explicit fields: the customer must never receive the provider's wallet, earnings or blocked flag.
  provider: {
    select: {
      id: true,
      userId: true,
      bio: true,
      rating: true,
      companyName: true,
      totalCompletedOrders: true,
      level: true,
      experienceYears: true,
      isAvailable: true,
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          profilePhoto: true,
          // The provider's default saved address is shown to customers as the workshop.
          addresses: {
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            take: 1,
            select: { addressText: true },
          },
          mobileNumber: true,
          role: true,
          status: true,
        },
      },
    },
  },
  customer: {
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          profilePhoto: true,
          mobileNumber: true,
          role: true,
          status: true,
          // False until the customer verifies their number by OTP: such a customer cannot pay online.
          isVerified: true,
        },
      },
    },
  },
  technician: {
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          profilePhoto: true,
          mobileNumber: true,
          role: true,
          status: true,
        },
      },
    },
  },
  service: { include: { category: true } },
  items: true,
  bookingDetail: true,
  paymentAndTip: true,
  advancePayments: { select: { amount: true, method: true, totalAtPayment: true, dueAfter: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
  revisions: true,
  providerReview: true,
  // The provider's rating of the customer: the customer, the provider side and admins all see it on the order.
  customerRating: { select: { rating: true, comment: true, createdAt: true } },
} satisfies Prisma.OrderInclude;

/**
 * The platform keeps a share of every job; on cash jobs the provider owes it, on online jobs the platform already
 * holds it. Each provider has their own percent (ProviderProfile.commissionRate, set by an admin); this is the
 * percent a new provider starts with.
 */
export const DEFAULT_COMMISSION_PERCENT = 10;

/** The platform's share of `amount` at `percent` (10 = 10%), in whole taka. */
export function commissionFor(amount: number, percent: number | Prisma.Decimal): number {
  return Math.round((amount * Number(percent)) / 100);
}

/** The global commission on orders from the platform, until an admin changes it (PlatformSetting). */
export const DEFAULT_PLATFORM_ORDER_COMMISSION = 50;

type GlobalCommissionReader = { platformSetting: { findUnique: Prisma.TransactionClient['platformSetting']['findUnique'] } };

/** The admin's global commission on orders from the platform, for providers without their own rate. */
export async function readPlatformOrderCommission(client: GlobalCommissionReader): Promise<number> {
  const row = await client.platformSetting.findUnique({ where: { id: 'default' }, select: { platformOrderCommissionRate: true } });
  return row ? Number(row.platformOrderCommissionRate) : DEFAULT_PLATFORM_ORDER_COMMISSION;
}

/** A provider's rate on platform orders: their own if an admin set one, else the global rate. Never 0 by accident. */
export const effectiveCommissionRate = (ownRate: Prisma.Decimal | number | null, globalRate: number): number =>
  ownRate === null ? globalRate : Number(ownRate);

/** The commission percent a provider is on now for orders from the platform (their own, or the global rate). */
export async function providerCommissionPercent(
  client: { providerProfile: { findUnique: Prisma.TransactionClient['providerProfile']['findUnique'] } } & GlobalCommissionReader,
  providerId: string,
): Promise<number> {
  const provider = await client.providerProfile.findUnique({ where: { id: providerId }, select: { commissionRate: true } });
  if (provider && provider.commissionRate !== null) return Number(provider.commissionRate);
  return readPlatformOrderCommission(client);
}

export interface PriceCalculationInput {
  originalPrice: number;
  adminCommission?: number;
  /** Used when adminCommission is not given. */
  commissionPercent?: number;
  additionalPrice?: number;
  advancePaid?: number;
}

export function calculateOrderPrices(data: PriceCalculationInput) {
  const originalPrice = data.originalPrice;
  const adminCommission =
    data.adminCommission !== undefined
      ? data.adminCommission
      : commissionFor(originalPrice, data.commissionPercent ?? DEFAULT_COMMISSION_PERCENT);
  const additionalPrice = data.additionalPrice ?? 0;
  const advancePaid = data.advancePaid ?? 0;
  const totalPrice = originalPrice + additionalPrice;
  const dueAmount = totalPrice - advancePaid;

  if (advancePaid > totalPrice) {
    throw new BadRequestException('Advance paid cannot exceed total price');
  }

  return {
    originalPrice,
    adminCommission,
    additionalPrice,
    totalPrice,
    advancePaid,
    dueAmount,
  };
}

export async function handleCommissionBalance(
  tx: any,
  order: { orderStatus: string; adminCommission: any; providerId: string; completedAt?: Date | string | null },
  newStatus?: string,
) {
  // An order is settled once: completing it again after a revision charges nothing and counts nothing.
  if (order.completedAt) return;
  if (newStatus === 'COMPLETED' && order.orderStatus !== 'COMPLETED') {
    const commission = Number(order.adminCommission || 0);
    if (commission > 0) {
      const provider = await tx.providerProfile.findUnique({
        where: { id: order.providerId },
        select: { id: true, walletBalance: true },
      });

      if (provider) {
        const newBalance = Number(provider.walletBalance) - commission;
        await tx.providerProfile.update({
          where: { id: order.providerId },
          data: {
            walletBalance: newBalance,
            isAvailable: newBalance >= 0,
            isBlockedForNegative: newBalance < 0,
            totalCompletedOrders: { increment: 1 },
          },
        });
      }
    } else {
      await tx.providerProfile.update({
        where: { id: order.providerId },
        data: {
          totalCompletedOrders: { increment: 1 },
        },
      });
    }
  }
}

export async function assertProvider(prisma: any, providerId: string) {
  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { id: true, walletBalance: true },
  });

  if (!provider) {
    throw new BadRequestException('Provider profile not found');
  }

  const balance = Number(provider.walletBalance);
  if (balance < 0) {
    // The provider still sees new orders; they take one once the previous due is paid.
    throw new BadRequestException(
      `Please clear your previous due of ৳${Math.ceil(-balance)} first, then you can accept new orders.`,
    );
  }
}

export async function assertCustomer(prisma: any, customerId: string) {
  const customer = await prisma.customerProfile.findUnique({
    where: { id: customerId },
    select: { id: true },
  });

  if (!customer) {
    throw new BadRequestException('Customer profile not found');
  }
}

export async function assertService(prisma: any, serviceId: string) {
  const service = await prisma.service.findFirst({
    where: { id: serviceId, isActive: true, isDeleted: false },
    select: { id: true },
  });

  if (!service) {
    throw new BadRequestException('Service is unavailable');
  }
}

export async function assertTechnician(prisma: any, technicianId?: string) {
  if (!technicianId) return;

  const technician = await prisma.technicianProfile.findUnique({
    where: { id: technicianId },
    select: { id: true },
  });

  if (!technician) {
    throw new BadRequestException('Technician profile not found');
  }
}

import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

export const ORDER_RELATIONS_INCLUDE = {
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

/** The platform keeps 10% of every job; on cash jobs the provider owes it, on online jobs the platform already holds it. */
export const COMMISSION_RATE = 0.1;

export interface PriceCalculationInput {
  originalPrice: number;
  adminCommission?: number;
  additionalPrice?: number;
  advancePaid?: number;
}

export function calculateOrderPrices(data: PriceCalculationInput) {
  const originalPrice = data.originalPrice;
  const adminCommission =
    data.adminCommission !== undefined
      ? data.adminCommission
      : Math.round(originalPrice * COMMISSION_RATE);
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
  order: { orderStatus: string; adminCommission: any; providerId: string },
  newStatus?: string,
) {
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

  if (Number(provider.walletBalance) < 0) {
    throw new BadRequestException(
      `Provider has a negative wallet balance (${provider.walletBalance.toString()} BDT). Account is locked from accepting new orders until wallet is recharged.`,
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

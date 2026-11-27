import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** How many of the latest reviews a profile lists. */
export const REVIEWS_SHOWN = 20;

/** One review as a profile lists it: the order, the stars, what was written and who wrote it. */
export interface ReceivedReview {
  /** The review itself (customer reviews only; ratings providers gave a customer have none). */
  reviewId?: string;
  /** Whether customers see it (an admin can hide a customer review). */
  isPublic?: boolean;
  orderId: string;
  referenceCode: string;
  rating: number;
  comment: string | null;
  createdAt: Date;
  fromName: string | null;
}

/** Reviews customers left on completed orders (about the provider and the technician who did the work), newest first. */
export async function reviewsFromCustomers(prisma: PrismaService, where: Prisma.ProviderReviewWhereInput): Promise<ReceivedReview[]> {
  const rows = await prisma.providerReview.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: REVIEWS_SHOWN,
    select: {
      id: true,
      isPublic: true,
      orderId: true,
      customerRating: true,
      reviewComment: true,
      createdAt: true,
      order: { select: { referenceCode: true } },
      customer: { select: { user: { select: { name: true, username: true } } } },
    },
  });
  return rows.map((row) => ({
    reviewId: row.id,
    isPublic: row.isPublic,
    orderId: row.orderId,
    referenceCode: row.order.referenceCode,
    rating: row.customerRating,
    comment: row.reviewComment,
    createdAt: row.createdAt,
    fromName: row.customer.user.name || row.customer.user.username,
  }));
}

/** Ratings providers and technicians gave a customer after their orders, newest first. */
export async function ratingsFromProviders(prisma: PrismaService, where: Prisma.CustomerRatingWhereInput): Promise<ReceivedReview[]> {
  const rows = await prisma.customerRating.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: REVIEWS_SHOWN,
    select: {
      orderId: true,
      rating: true,
      comment: true,
      createdAt: true,
      order: { select: { referenceCode: true, provider: { select: { companyName: true, user: { select: { name: true, username: true } } } } } },
    },
  });
  return rows.map((row) => ({
    orderId: row.orderId,
    referenceCode: row.order.referenceCode,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.createdAt,
    fromName: row.order.provider.companyName || row.order.provider.user.name || row.order.provider.user.username,
  }));
}

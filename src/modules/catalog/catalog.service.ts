import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_HOW_TO_ORDER,
  discountAmount,
  ownOrInherited,
  reviewerName,
  startingPrice,
  summarizeRatings,
} from './catalog-view';

const LIVE = { isActive: true, isDeleted: false } as const;
const VARIANT_SELECT = {
  id: true,
  name: true,
  nameBn: true,
  imageUrl: true,
  price: true,
  originalPrice: true,
  priceUnit: true,
  durationMin: true,
} satisfies Prisma.ServiceVariantSelect;
/** Only reviews the platform shows publicly. */
const PUBLIC_REVIEW: Prisma.ProviderReviewWhereInput = {
  isPublic: true,
  moderationStatus: 'APPROVED',
  status: 'ACTIVE',
};

/**
 * Read side of the four-level catalog for the customer app (public, no login):
 * Category (ServiceGroup) -> Main service (ServiceCategory, one chat) -> Sub-service (Service, a card) -> Variant.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Top bar: every live category that has at least one live main service. */
  async listGroups() {
    const groups = await this.prisma.serviceGroup.findMany({
      where: LIVE,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        nameBn: true,
        slug: true,
        iconUrl: true,
        _count: { select: { categories: { where: LIVE } } },
      },
    });
    return groups
      .filter((group) => group._count.categories > 0)
      .map(({ _count, ...group }) => ({
        ...group,
        mainServiceCount: _count.categories,
      }));
  }

  /** Left chat list: the main services, optionally of one category, with rating and "starts from". */
  async listMainServices(groupId?: string) {
    const categories = await this.prisma.serviceCategory.findMany({
      where: { ...LIVE, ...(groupId ? { groupId } : {}), group: { is: LIVE } },
      // Category by category (the top bar's order), then the main services inside each.
      orderBy: [{ group: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        shortDescription: true,
        iconUrl: true,
        imageUrl: true,
        isPopular: true,
        groupId: true,
        group: { select: { id: true, name: true, nameBn: true } },
        services: {
          where: { ...LIVE, isCustom: false },
          select: {
            basePrice: true,
            variants: {
              where: LIVE,
              select: { price: true, originalPrice: true },
            },
          },
        },
      },
    });

    const stats = await this.categoryStats(
      categories.map((category) => category.id),
    );
    return categories.map(({ services, ...category }) => {
      const variants = services.flatMap((service) =>
        service.variants.length
          ? service.variants
          : [{ price: service.basePrice, originalPrice: null }],
      );
      return {
        ...category,
        subServiceCount: services.length,
        startsFrom: variants.length ? startingPrice(variants, 0).price : null,
        ...stats.get(category.id),
      };
    });
  }

  /** One main service's chat page: header numbers and its sub-service cards (the Custom card is drawn by the app). */
  async getMainService(id: string) {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { ...LIVE, OR: [{ id }, { slug: id }] },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        iconUrl: true,
        imageUrl: true,
        groupId: true,
        group: { select: { id: true, name: true, nameBn: true } },
        services: {
          where: { ...LIVE, isCustom: false },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            nameBn: true,
            description: true,
            imageUrl: true,
            basePrice: true,
            isPopular: true,
            variants: {
              where: LIVE,
              orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
              select: VARIANT_SELECT,
            },
          },
        },
      },
    });
    if (!category) throw new NotFoundException('Service not found');

    const stats = await this.categoryStats([category.id]);
    const reviewsByService = await this.subServiceRatings(
      category.services.map((service) => service.id),
    );

    return {
      ...category,
      ...stats.get(category.id),
      services: category.services.map((service) => {
        const start = startingPrice(service.variants, service.basePrice);
        return {
          ...service,
          startsFrom: start.price,
          startsFromOriginal: start.originalPrice,
          discount: discountAmount(start.price, start.originalPrice),
          rating: reviewsByService.get(service.id) ?? {
            average: null,
            count: 0,
          },
        };
      }),
    };
  }

  /** Right-hand panel of one sub-service: variants, Overview, FAQ, How to order, Review and Details. */
  async getSubService(id: string) {
    const service = await this.prisma.service.findFirst({
      where: { id, ...LIVE, isCustom: false, category: { is: LIVE } },
      select: {
        id: true,
        name: true,
        nameBn: true,
        description: true,
        imageUrl: true,
        basePrice: true,
        priceUnit: true,
        features: true,
        included: true,
        excluded: true,
        details: true,
        categoryId: true,
        variants: {
          where: LIVE,
          orderBy: [{ sortOrder: 'asc' }, { price: 'asc' }],
          select: VARIANT_SELECT,
        },
        faqs: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            question: true,
            questionBn: true,
            answer: true,
            answerBn: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            included: true,
            excluded: true,
            details: true,
            description: true,
            howToOrder: true,
            faqs: {
              where: { isActive: true, serviceId: null },
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                question: true,
                questionBn: true,
                answer: true,
                answerBn: true,
              },
            },
          },
        },
      },
    });
    if (!service) throw new NotFoundException('Service not found');

    // Older sub-services may have no variant yet: their base price stands in as the single option.
    const variants = service.variants.length
      ? service.variants
      : [
          {
            id: null,
            name: 'Standard',
            nameBn: null,
            imageUrl: null,
            price: service.basePrice,
            originalPrice: null,
            priceUnit: service.priceUnit,
            durationMin: null,
          },
        ];
    const reviews = await this.getReviews({ serviceId: service.id }, 1, 5);
    const servedCount = await this.prisma.order.count({
      where: {
        orderStatus: OrderStatus.COMPLETED,
        items: { some: { subServiceId: service.id } },
      },
    });

    const { category, faqs, included, excluded, details, ...rest } = service;
    return {
      ...rest,
      variants,
      mainService: { id: category.id, name: category.name },
      overview: {
        included: ownOrInherited(included, category.included),
        excluded: ownOrInherited(excluded, category.excluded),
      },
      faqs: [...faqs, ...category.faqs],
      howToOrder: category.howToOrder.length
        ? category.howToOrder
        : DEFAULT_HOW_TO_ORDER,
      details:
        details ||
        category.details ||
        service.description ||
        category.description ||
        null,
      servedCount,
      reviews,
    };
  }

  /** Public reviews of a sub-service (orders that contained it) or of a whole main service, newest first. */
  async getReviews(
    scope: { serviceId?: string; categoryId?: string },
    page = 1,
    pageSize = 10,
  ) {
    const orderScope: Prisma.OrderWhereInput = scope.serviceId
      ? {
          OR: [
            { items: { some: { subServiceId: scope.serviceId } } },
            { serviceId: scope.serviceId },
          ],
        }
      : { categoryId: scope.categoryId };
    const where: Prisma.ProviderReviewWhereInput = {
      ...PUBLIC_REVIEW,
      order: orderScope,
    };

    const [ratings, rows] = await Promise.all([
      this.prisma.providerReview.findMany({
        where,
        select: { customerRating: true },
      }),
      this.prisma.providerReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(1, page) - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          customerRating: true,
          reviewComment: true,
          createdAt: true,
          order: { select: { completedAt: true } },
          customer: {
            select: { user: { select: { name: true, profilePhoto: true } } },
          },
        },
      }),
    ]);

    return {
      summary: summarizeRatings(ratings.map((row) => row.customerRating)),
      page,
      pageSize,
      items: rows.map((row) => ({
        id: row.id,
        rating: row.customerRating,
        comment: row.reviewComment,
        createdAt: row.createdAt,
        takenOn: row.order.completedAt,
        reviewerName: reviewerName(row.customer.user.name),
        reviewerPicture: row.customer.user.profilePhoto ?? null,
      })),
    };
  }

  /** Average rating, review count and completed-order count for each main service. */
  private async categoryStats(categoryIds: string[]) {
    const result = new Map<
      string,
      { rating: { average: number | null; count: number }; servedCount: number }
    >();
    if (categoryIds.length === 0) return result;

    const [ratings, served] = await Promise.all([
      this.prisma.providerReview.findMany({
        where: { ...PUBLIC_REVIEW, order: { categoryId: { in: categoryIds } } },
        select: {
          customerRating: true,
          order: { select: { categoryId: true } },
        },
      }),
      this.prisma.order.groupBy({
        by: ['categoryId'],
        where: {
          categoryId: { in: categoryIds },
          orderStatus: OrderStatus.COMPLETED,
        },
        _count: { _all: true },
      }),
    ]);

    for (const id of categoryIds) {
      const summary = summarizeRatings(
        ratings
          .filter((row) => row.order.categoryId === id)
          .map((row) => row.customerRating),
      );
      const servedCount =
        served.find((row) => row.categoryId === id)?._count._all ?? 0;
      result.set(id, {
        rating: { average: summary.average, count: summary.count },
        servedCount,
      });
    }
    return result;
  }

  private async subServiceRatings(serviceIds: string[]) {
    const result = new Map<string, { average: number | null; count: number }>();
    if (serviceIds.length === 0) return result;
    const rows = await this.prisma.providerReview.findMany({
      where: {
        ...PUBLIC_REVIEW,
        order: { items: { some: { subServiceId: { in: serviceIds } } } },
      },
      select: {
        customerRating: true,
        order: { select: { items: { select: { subServiceId: true } } } },
      },
    });
    for (const id of serviceIds) {
      const summary = summarizeRatings(
        rows
          .filter((row) =>
            row.order.items.some((item) => item.subServiceId === id),
          )
          .map((row) => row.customerRating),
      );
      result.set(id, { average: summary.average, count: summary.count });
    }
    return result;
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OfferStatus, OrderStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { USER_EVENT_PUBLISHER } from './user-events';
import { isCustomServiceId } from '../order-placement/custom-service';
import { commissionFor, providerCommissionPercent } from '../orders/orders.helpers';
import type { UserEventPublisher } from './user-events';
import { ProviderRankingService, offerSeconds } from './provider-ranking.service';
import { RankingWeights, dispatchScore, rankProviders } from './ranking-rules';
import { kycAllowsOrdersWhere } from '../provider-kyc/kyc-rules';

/** How many providers hear about a new order at once. */
const providersPerWave = () => Number(process.env.DISPATCH_PROVIDERS_PER_WAVE) || 5;
/** With ranking on, at most this many eligible providers are scored to pick each wave. */
const RANKING_POOL = 200;

type Tx = Prisma.TransactionClient;

/** Where the work will be done: the district and upazila the customer picked on the order. */
export interface ServiceLocation {
  districtId: number;
  upazilaId: number;
}

@Injectable()
export class OrderDispatchService {
  private readonly logger = new Logger(OrderDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_EVENT_PUBLISHER) private readonly events: UserEventPublisher,
    private readonly ranking: ProviderRankingService,
  ) {}

  /**
   * Admin preview: who would be asked first for this service and place, and how each score is made, with the
   * weights being tried (not saved yet). The same eligibility as a real order: area, skill, active, available.
   */
  async previewRanking(input: { serviceId: string; location?: ServiceLocation | null; weights: RankingWeights }) {
    const order = { serviceId: input.serviceId };
    let ids: string[];
    let area: 'UPAZILA' | 'DISTRICT' | 'ANY' = 'ANY';
    if (!input.location) ids = await this.eligibleIds(order, [], this.prisma, RANKING_POOL, {});
    else {
      ids = await this.eligibleIds(order, [], this.prisma, RANKING_POOL, { serviceAreas: { some: { upazilaId: input.location.upazilaId } } });
      area = 'UPAZILA';
      if (ids.length === 0) {
        ids = await this.eligibleIds(order, [], this.prisma, RANKING_POOL, { serviceAreas: { some: { districtId: input.location.districtId } } });
        area = 'DISTRICT';
      }
    }

    const [stats, profiles] = await Promise.all([
      this.ranking.statsFor(ids),
      this.prisma.providerProfile.findMany({ where: { id: { in: ids } }, select: { id: true, companyName: true, user: { select: { name: true, username: true } } } }),
    ]);
    const names = new Map(profiles.map((profile) => [profile.id, profile.companyName?.trim() || profile.user.name || profile.user.username || 'Provider']));
    const ranked = rankProviders(ids, stats, input.weights, offerSeconds());
    const perWave = providersPerWave();

    return {
      area,
      providersPerWave: perWave,
      providers: ranked.map((id, index) => {
        const providerStats = stats.get(id) ?? null;
        const result = providerStats ? dispatchScore(providerStats, input.weights, offerSeconds()) : null;
        return {
          providerId: id,
          name: names.get(id) ?? 'Provider',
          position: index + 1,
          wave: Math.floor(index / perWave) + 1,
          score: result?.score ?? null,
          parts: result?.parts ?? null,
          stats: providerStats,
        };
      }),
    };
  }

  /**
   * Providers who may be offered this order: they enabled the service as a skill, are active and available
   * (a negative wallet does not count against them: they are offered it but must clear the due before
   * accepting), are not the customer themselves, and were not offered it before.
   * Better rated and more experienced providers are asked first. A provider with no skills never appears.
   *
   * Where the work is done decides who is asked: providers who cover the order's upazila first and, once
   * none of those is left, providers who cover its district. A provider with no service area is never
   * asked. An order without a location (an admin-made custom order) skips the area check.
   */
  async findEligibleProviderIds(order: { serviceId: string; serviceIds?: string[]; customerUserId?: string; location?: ServiceLocation | null }, alreadyOfferedIds: string[] = [], client: Tx | PrismaService = this.prisma, take = providersPerWave()) {
    if (!order.location) return this.queryProviders(order, alreadyOfferedIds, client, take, {});

    const inUpazila = await this.queryProviders(order, alreadyOfferedIds, client, take, { serviceAreas: { some: { upazilaId: order.location.upazilaId } } });
    if (inUpazila.length > 0) return inUpazila;
    return this.queryProviders(order, alreadyOfferedIds, client, take, { serviceAreas: { some: { districtId: order.location.districtId } } });
  }

  /**
   * With the admin's dispatch ranking on, the eligible providers (up to RANKING_POOL) are ordered by their dispatch
   * score and the best `take` are asked. Off (the default), or if ranking fails for any reason, the old order
   * (rating, then completed orders) stands: a ranking problem never stops an order from going out.
   */
  private async queryProviders(
    order: { serviceId: string; serviceIds?: string[]; customerUserId?: string },
    alreadyOfferedIds: string[],
    client: Tx | PrismaService,
    take: number,
    areaFilter: Prisma.ProviderProfileWhereInput,
  ) {
    const settings = await this.ranking.getSettings().catch(() => null);
    if (!settings?.isEnabled) return this.eligibleIds(order, alreadyOfferedIds, client, take, areaFilter);

    const pool = await this.eligibleIds(order, alreadyOfferedIds, client, RANKING_POOL, areaFilter);
    try {
      return rankProviders(pool, await this.ranking.statsFor(pool), settings.weights, offerSeconds()).slice(0, take);
    } catch (error) {
      this.logger.warn(`Dispatch ranking skipped, using rating order: ${error instanceof Error ? error.message : String(error)}`);
      return pool.slice(0, take);
    }
  }

  /** Every provider who may be offered this order, in the old order (rating, then completed orders). */
  private async eligibleIds(
    order: { serviceId: string; serviceIds?: string[]; customerUserId?: string },
    alreadyOfferedIds: string[],
    client: Tx | PrismaService,
    take: number,
    areaFilter: Prisma.ProviderProfileWhereInput,
  ) {
    // An admin's custom order (a service not in the catalog) goes to every available provider in the area:
    // nobody has that service switched on, so the skill filter would leave no one.
    const isCustom = await isCustomServiceId(client, order.serviceId);
    const skillFilter = isCustom ? {} : await this.skillFilter(client, order.serviceIds?.length ? order.serviceIds : [order.serviceId]);
    const providers = await client.providerProfile.findMany({
      where: {
        ...areaFilter,
        // A negative wallet still gets the offer (and its notification); accepting waits until the due is
        // cleared (assertProvider). Such a provider is marked unavailable only because of the wallet.
        OR: [{ isAvailable: true }, { isBlockedForNegative: true }],
        ...(alreadyOfferedIds.length > 0 ? { id: { notIn: alreadyOfferedIds } } : {}),
        // Verified (KYC approved), or a provider from before KYC was required who is still in their grace period.
        AND: [kycAllowsOrdersWhere()],
        user: {
          role: UserRole.PROVIDER,
          status: 'ACTIVE',
          isRestricted: false,
          ...(order.customerUserId ? { id: { not: order.customerUserId } } : {}),
          ...skillFilter,
        },
      },
      orderBy: [{ rating: 'desc' }, { totalCompletedOrders: 'desc' }],
      take,
      select: { id: true },
    });
    return providers.map((provider) => provider.id);
  }

  /**
   * Offers the order to the next group of providers, unless a group is still deciding or the order has
   * been taken. Runs under a lock on the order row, so the first wave and the timed follow-up waves can
   * never overlap. Returns how many providers were offered the order.
   */
  /**
   * Which skills a provider needs. A cart order needs every sub-service in it switched on. A customer's custom
   * order (the main service's hidden "Custom" sub-service) goes to anyone offering any sub-service of that main service.
   */
  private async skillFilter(client: Tx | PrismaService, serviceIds: string[]): Promise<Prisma.UserWhereInput> {
    const ids = [...new Set(serviceIds)];
    if (ids.length === 1) {
      const service = await client.service.findUnique({ where: { id: ids[0] }, select: { isCustom: true, categoryId: true } });
      if (service?.isCustom) return { serviceAssignments: { some: { isActive: true, service: { categoryId: service.categoryId, isCustom: false } } } };
      return { serviceAssignments: { some: { serviceId: ids[0], isActive: true } } };
    }
    // A custom order is always a single item, so several ids are a cart: every one is needed.
    return { AND: ids.map((serviceId) => ({ serviceAssignments: { some: { serviceId, isActive: true } } })) };
  }

  async dispatchNextWave(orderId: string, knownLocation?: ServiceLocation, knownServiceIds?: string[]): Promise<number> {
    const offered = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`);
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { orderStatus: true, serviceId: true, items: { select: { subServiceId: true } }, customer: { select: { userId: true } }, bookingDetail: { select: { districtId: true, upazilaId: true } }, offers: { select: { providerId: true, wave: true, status: true, expiresAt: true } } },
      });
      if (!order || order.orderStatus !== OrderStatus.PENDING) return null;

      const now = new Date();
      const isWaveStillOpen = order.offers.some((offer) => offer.status === OfferStatus.OFFERED && offer.expiresAt > now);
      if (isWaveStillOpen) return null;

      const providerIds = await this.findEligibleProviderIds(
        // The first wave runs before the booking details are saved, so the caller hands the location over.
        {
          serviceId: order.serviceId,
          // Like the location, the first wave runs before the order's items are saved.
          serviceIds: knownServiceIds ?? (order.items?.length ? order.items.map((item) => item.subServiceId) : undefined),
          customerUserId: order.customer.userId,
          location: knownLocation ?? order.bookingDetail,
        },
        order.offers.map((offer) => offer.providerId),
        tx,
      );
      if (providerIds.length === 0) return null;

      const wave = Math.max(0, ...order.offers.map((offer) => offer.wave)) + 1;
      const expiresAt = new Date(now.getTime() + offerSeconds() * 1000);
      await tx.orderOffer.createMany({ data: providerIds.map((providerId) => ({ orderId, providerId, wave, expiresAt })) });
      return { providerIds, expiresAt };
    });

    if (!offered) return 0;
    await this.notifyOffered(orderId, offered.providerIds, offered.expiresAt);
    return offered.providerIds.length;
  }

  /**
   * Tells each offered provider's open app about the new order, right after the offers are saved. A failure
   * here must never undo the dispatch: the provider's list still picks the offer up on its next refresh.
   */
  private async notifyOffered(orderId: string, providerIds: string[], expiresAt: Date) {
    try {
      const [order, providers] = await Promise.all([
        this.prisma.order.findUnique({ where: { id: orderId }, select: { referenceCode: true, service: { select: { name: true } } } }),
        this.prisma.providerProfile.findMany({ where: { id: { in: providerIds } }, select: { userId: true } }),
      ]);
      for (const { userId } of providers) {
        this.events.publishToUser(userId, 'orderOffer', {
          orderId,
          referenceCode: order?.referenceCode ?? null,
          serviceName: order?.service.name ?? null,
          expiresAt: expiresAt.toISOString(),
        });
      }
    } catch (error) {
      this.logger.warn(`Could not notify providers about order ${orderId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Close offers whose time ran out, then offer those orders to the next group. The scheduler calls this every 10 seconds. */
  async advanceExpiredWaves(): Promise<number> {
    const now = new Date();
    await this.prisma.orderOffer.updateMany({
      where: { status: OfferStatus.OFFERED, expiresAt: { lte: now } },
      data: { status: OfferStatus.EXPIRED },
    });

    // Pending orders that were offered at least once and have nobody deciding right now.
    const waiting = await this.prisma.order.findMany({
      where: { orderStatus: OrderStatus.PENDING, offers: { some: {}, none: { status: OfferStatus.OFFERED } } },
      select: { id: true },
      take: 100,
    });

    let offered = 0;
    for (const { id } of waiting) {
      try {
        offered += await this.dispatchNextWave(id);
      } catch (error) {
        this.logger.warn(`Could not offer order ${id} to the next group: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return offered;
  }

  /** The provider must hold a live offer for the order to take it. Returns that offer's id. */
  async assertLiveOffer(orderId: string, providerId: string, client: Tx | PrismaService = this.prisma): Promise<string> {
    const offer = await client.orderOffer.findUnique({ where: { orderId_providerId: { orderId, providerId } } });
    if (!offer || offer.status !== OfferStatus.OFFERED || offer.expiresAt <= new Date()) {
      throw new BadRequestException('This order is no longer offered to you');
    }
    return offer.id;
  }

  /**
   * Settles the offers once a provider has taken the order: theirs is accepted, everyone else's is withdrawn.
   * Call it in the same transaction that gave the order to this provider.
   */
  async closeOffersAfterAcceptance(tx: Tx, orderId: string, acceptedProviderId: string): Promise<void> {
    const now = new Date();
    // The order now runs on the accepting provider's own commission percent (it was the stand-in's until now).
    const [percent, order] = await Promise.all([
      providerCommissionPercent(tx, acceptedProviderId),
      tx.order.findUnique({ where: { id: orderId }, select: { totalPrice: true } }),
    ]);
    if (order) {
      await tx.order.update({ where: { id: orderId }, data: { commissionRate: percent, adminCommission: commissionFor(Number(order.totalPrice), percent) } });
    }
    await tx.orderOffer.updateMany({ where: { orderId, providerId: acceptedProviderId }, data: { status: OfferStatus.ACCEPTED, respondedAt: now } });
    await tx.orderOffer.updateMany({ where: { orderId, providerId: { not: acceptedProviderId }, status: OfferStatus.OFFERED }, data: { status: OfferStatus.WITHDRAWN, respondedAt: now } });
  }

  /** A provider turns down their offer. The order stays for the others; if that was the last open offer, the next group is asked at once. */
  async declineOffer(orderId: string, actor: { id: string; role: UserRole }): Promise<{ declined: true }> {
    if (actor.role !== UserRole.PROVIDER) throw new ForbiddenException('Only a provider can decline an offer');
    const provider = await this.prisma.providerProfile.findUnique({ where: { userId: actor.id }, select: { id: true } });
    if (!provider) throw new NotFoundException('Provider profile not found');

    const declined = await this.prisma.orderOffer.updateMany({
      where: { orderId, providerId: provider.id, status: OfferStatus.OFFERED },
      data: { status: OfferStatus.DECLINED, respondedAt: new Date() },
    });
    if (declined.count === 0) throw new ConflictException('There is no open offer for you on this order');

    const stillOpen = await this.prisma.orderOffer.count({ where: { orderId, status: OfferStatus.OFFERED, expiresAt: { gt: new Date() } } });
    if (stillOpen === 0) await this.dispatchNextWave(orderId);
    return { declined: true };
  }
}

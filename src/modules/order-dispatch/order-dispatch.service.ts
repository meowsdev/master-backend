import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OfferStatus, OrderStatus, Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** How many providers hear about a new order at once. */
const providersPerWave = () => Number(process.env.DISPATCH_PROVIDERS_PER_WAVE) || 5;
/** How long a provider has to answer before the order moves on to the next group. */
const offerSeconds = () => Number(process.env.DISPATCH_OFFER_SECONDS) || 90;

type Tx = Prisma.TransactionClient;

@Injectable()
export class OrderDispatchService {
  private readonly logger = new Logger(OrderDispatchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Providers who may be offered this order: they enabled the service as a skill, are available, are not
   * blocked by a negative wallet, are not the customer themselves, and were not offered it before.
   * Better rated and more experienced providers are asked first. A provider with no skills never appears.
   */
  async findEligibleProviderIds(order: { serviceId: string; customerUserId?: string }, alreadyOfferedIds: string[] = [], client: Tx | PrismaService = this.prisma, take = providersPerWave()) {
    const providers = await client.providerProfile.findMany({
      where: {
        isAvailable: true,
        isBlockedForNegative: false,
        ...(alreadyOfferedIds.length > 0 ? { id: { notIn: alreadyOfferedIds } } : {}),
        user: {
          role: UserRole.PROVIDER,
          status: 'ACTIVE',
          ...(order.customerUserId ? { id: { not: order.customerUserId } } : {}),
          serviceAssignments: { some: { serviceId: order.serviceId, isActive: true } },
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
  async dispatchNextWave(orderId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`);
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { orderStatus: true, serviceId: true, customer: { select: { userId: true } }, offers: { select: { providerId: true, wave: true, status: true, expiresAt: true } } },
      });
      if (!order || order.orderStatus !== OrderStatus.PENDING) return 0;

      const now = new Date();
      const isWaveStillOpen = order.offers.some((offer) => offer.status === OfferStatus.OFFERED && offer.expiresAt > now);
      if (isWaveStillOpen) return 0;

      const providerIds = await this.findEligibleProviderIds(
        { serviceId: order.serviceId, customerUserId: order.customer.userId },
        order.offers.map((offer) => offer.providerId),
        tx,
      );
      if (providerIds.length === 0) return 0;

      const wave = Math.max(0, ...order.offers.map((offer) => offer.wave)) + 1;
      const expiresAt = new Date(now.getTime() + offerSeconds() * 1000);
      await tx.orderOffer.createMany({ data: providerIds.map((providerId) => ({ orderId, providerId, wave, expiresAt })) });
      return providerIds.length;
    });
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

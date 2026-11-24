import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrderDispatchService } from './order-dispatch.service';
import { CUSTOM_SERVICE_SLUG, resetCustomServiceCache } from '../order-placement/custom-service';

const NOW = new Date('2027-01-01T00:00:00Z');
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

interface Offer { providerId: string; wave: number; status: string; expiresAt: Date }

function build(options: { orderStatus?: string; offers?: Offer[]; eligible?: string[]; location?: { districtId: number; upazilaId: number } | null; isCustomService?: boolean } = {}) {
  const order = { orderStatus: options.orderStatus ?? 'PENDING', serviceId: 's1', customer: { userId: 'customer-user' }, bookingDetail: options.location ?? null, offers: options.offers ?? [] };
  const tx = {
    $queryRaw: jest.fn(),
    order: { findUnique: jest.fn().mockResolvedValue({ ...order, totalPrice: 2000 }), update: jest.fn() },
    // The order's service: a catalog one, or the hidden custom service an admin's typed order hangs off.
    service: { findUnique: jest.fn().mockResolvedValue({ slug: options.isCustomService ? CUSTOM_SERVICE_SLUG : 'ac-servicing' }) },
    providerProfile: {
      findMany: jest.fn().mockResolvedValue((options.eligible ?? ['p1', 'p2', 'p3']).map((id) => ({ id }))),
      findUnique: jest.fn().mockResolvedValue({ commissionRate: 15 }),
    },
    orderOffer: { createMany: jest.fn(), updateMany: jest.fn() },
  };
  const providerProfile = { findMany: tx.providerProfile.findMany, findUnique: jest.fn() };
  const prisma = {
    ...tx,
    providerProfile,
    orderOffer: { ...tx.orderOffer, findUnique: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const gateway = { publishToUser: jest.fn() };
  return { service: new OrderDispatchService(prisma as never, gateway as never), tx, prisma, gateway };
}

describe('OrderDispatchService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    resetCustomServiceCache();
  });
  afterEach(() => jest.useRealTimers());

  describe('who is eligible', () => {
    it("offers an admin's custom order to every available provider, whatever services they have on", async () => {
      const { service, tx } = build({ isCustomService: true });
      await service.dispatchNextWave('o1');
      const where = tx.providerProfile.findMany.mock.calls[0][0].where;
      expect(where.user).not.toHaveProperty('serviceAssignments');
      // Everything else about who may be asked stays the same.
      expect(where.user).toMatchObject({ role: 'PROVIDER', status: 'ACTIVE', isRestricted: false, id: { not: 'customer-user' } });
    });

    it('asks only active providers with the skill who are free (or only held back by a negative wallet) and not the customer', async () => {
      const { service, tx } = build();
      await service.dispatchNextWave('o1');
      const where = tx.providerProfile.findMany.mock.calls[0][0].where;
      // A negative wallet still gets the offer; accepting is what waits for the due to be paid.
      expect(where.OR).toEqual([{ isAvailable: true }, { isBlockedForNegative: true }]);
      expect(where).not.toHaveProperty('isBlockedForNegative');
      expect(where.user).toMatchObject({ role: 'PROVIDER', status: 'ACTIVE', id: { not: 'customer-user' }, serviceAssignments: { some: { serviceId: 's1', isActive: true } } });
    });

    it('takes at most five providers per group', async () => {
      const { service, tx } = build();
      await service.dispatchNextWave('o1');
      expect(tx.providerProfile.findMany.mock.calls[0][0].take).toBe(5);
    });
  });

  describe('waves', () => {
    it('offers a new order to the first group with an expiry', async () => {
      const { service, tx } = build({ eligible: ['p1', 'p2', 'p3', 'p4', 'p5'] });
      expect(await service.dispatchNextWave('o1')).toBe(5);
      const rows = tx.orderOffer.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(5);
      expect(rows[0]).toMatchObject({ orderId: 'o1', providerId: 'p1', wave: 1, expiresAt: later(90) });
    });

    it('does not start another group while the first is still deciding', async () => {
      const { service, tx } = build({ offers: [{ providerId: 'p1', wave: 1, status: 'OFFERED', expiresAt: later(30) }] });
      expect(await service.dispatchNextWave('o1')).toBe(0);
      expect(tx.orderOffer.createMany).not.toHaveBeenCalled();
    });

    it('moves on to the next group once the first has expired, skipping providers already asked', async () => {
      const { service, tx } = build({ offers: [{ providerId: 'p1', wave: 1, status: 'EXPIRED', expiresAt: later(-10) }] });
      await service.dispatchNextWave('o1');
      expect(tx.providerProfile.findMany.mock.calls[0][0].where.id).toEqual({ notIn: ['p1'] });
      expect(tx.orderOffer.createMany.mock.calls[0][0].data[0].wave).toBe(2);
    });

    it('does nothing for an order that is no longer pending', async () => {
      const { service, tx } = build({ orderStatus: 'IN_PROGRESS' });
      expect(await service.dispatchNextWave('o1')).toBe(0);
      expect(tx.orderOffer.createMany).not.toHaveBeenCalled();
    });

    it('offers nothing when no eligible provider is left', async () => {
      const { service, tx } = build({ eligible: [] });
      expect(await service.dispatchNextWave('o1')).toBe(0);
      expect(tx.orderOffer.createMany).not.toHaveBeenCalled();
    });
  });

  describe('accepting', () => {
    it('needs a live offer', async () => {
      const { service, prisma } = build();
      prisma.orderOffer.findUnique.mockResolvedValue({ id: 'x', status: 'OFFERED', expiresAt: later(10) });
      await expect(service.assertLiveOffer('o1', 'p1')).resolves.toBe('x');
      prisma.orderOffer.findUnique.mockResolvedValue({ id: 'x', status: 'OFFERED', expiresAt: later(-1) });
      await expect(service.assertLiveOffer('o1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
      prisma.orderOffer.findUnique.mockResolvedValue(null);
      await expect(service.assertLiveOffer('o1', 'p1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts the winner and withdraws everyone else', async () => {
      const { service, tx } = build();
      await service.closeOffersAfterAcceptance(tx as never, 'o1', 'p2');
      expect(tx.orderOffer.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { orderId: 'o1', providerId: 'p2' }, data: expect.objectContaining({ status: 'ACCEPTED' }) }));
      expect(tx.orderOffer.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { orderId: 'o1', providerId: { not: 'p2' }, status: 'OFFERED' }, data: expect.objectContaining({ status: 'WITHDRAWN' }) }));
    });

    it("puts the order on the accepting provider's own commission percent", async () => {
      const { service, tx } = build();
      await service.closeOffersAfterAcceptance(tx as never, 'o1', 'p2');
      expect(tx.providerProfile.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'p2' } }));
      expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { commissionRate: 15, adminCommission: 300 } });
    });
  });

  describe('declining', () => {
    it('only a provider can decline', async () => {
      const { service } = build();
      await expect(service.declineOffer('o1', { id: 'u', role: 'CUSTOMER' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('declines only their own offer and asks the next group when it was the last open one', async () => {
      const { service, prisma, tx } = build({ eligible: ['p9'] });
      prisma.providerProfile.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.orderOffer.updateMany.mockResolvedValue({ count: 1 });
      prisma.orderOffer.count.mockResolvedValue(0);
      await service.declineOffer('o1', { id: 'u', role: 'PROVIDER' });
      expect(prisma.orderOffer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: 'o1', providerId: 'p1', status: 'OFFERED' }, data: expect.objectContaining({ status: 'DECLINED' }) }));
      expect(tx.orderOffer.createMany).toHaveBeenCalled();
    });

    it('keeps the order with the others when some offers are still open', async () => {
      const { service, prisma, tx } = build();
      prisma.providerProfile.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.orderOffer.updateMany.mockResolvedValue({ count: 1 });
      prisma.orderOffer.count.mockResolvedValue(3);
      await service.declineOffer('o1', { id: 'u', role: 'PROVIDER' });
      expect(tx.orderOffer.createMany).not.toHaveBeenCalled();
    });

    it('refuses when there is no open offer to decline', async () => {
      const { service, prisma } = build();
      prisma.providerProfile.findUnique.mockResolvedValue({ id: 'p1' });
      prisma.orderOffer.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.declineOffer('o1', { id: 'u', role: 'PROVIDER' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('where the work is done', () => {
    const location = { districtId: 7, upazilaId: 70 };

    it('asks the providers of the order\'s upazila first', async () => {
      const { service, tx } = build({ location });
      await service.dispatchNextWave('o1');
      expect(tx.providerProfile.findMany.mock.calls[0][0].where.serviceAreas).toEqual({ some: { upazilaId: 70 } });
    });

    it('widens to the district only when nobody in the upazila is left', async () => {
      const { service, tx } = build({ location });
      tx.providerProfile.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'p9' }]);
      expect(await service.dispatchNextWave('o1')).toBe(1);
      expect(tx.providerProfile.findMany.mock.calls[1][0].where.serviceAreas).toEqual({ some: { districtId: 7 } });
    });

    it('offers nothing when no provider covers the upazila or the district', async () => {
      const { service, tx } = build({ location });
      tx.providerProfile.findMany.mockResolvedValue([]);
      expect(await service.dispatchNextWave('o1')).toBe(0);
    });

    it('lets the caller hand the location over before the booking details exist', async () => {
      const { service, tx } = build({ location: null });
      await service.dispatchNextWave('o1', location);
      expect(tx.providerProfile.findMany.mock.calls[0][0].where.serviceAreas).toEqual({ some: { upazilaId: 70 } });
    });

    it('skips the area check for an order that has no location', async () => {
      const { service, tx } = build({ location: null });
      await service.dispatchNextWave('o1');
      expect(tx.providerProfile.findMany.mock.calls[0][0].where.serviceAreas).toBeUndefined();
    });

    it('tells each offered provider\'s app about the order', async () => {
      const { service, prisma, gateway } = build({ location });
      prisma.order.findUnique = jest.fn().mockResolvedValueOnce({ orderStatus: 'PENDING', serviceId: 's1', customer: { userId: 'c' }, bookingDetail: location, offers: [] }).mockResolvedValueOnce({ referenceCode: 'ORD-1', service: { name: 'AC Repair' } });
      prisma.providerProfile.findMany = jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]);
      await service.dispatchNextWave('o1');
      expect(gateway.publishToUser).toHaveBeenCalledWith('u1', 'orderOffer', expect.objectContaining({ orderId: 'o1', serviceName: 'AC Repair' }));
      expect(gateway.publishToUser).toHaveBeenCalledTimes(2);
    });
  });
});

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrderDispatchService } from './order-dispatch.service';

const NOW = new Date('2027-01-01T00:00:00Z');
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

interface Offer { providerId: string; wave: number; status: string; expiresAt: Date }

function build(options: { orderStatus?: string; offers?: Offer[]; eligible?: string[] } = {}) {
  const order = { orderStatus: options.orderStatus ?? 'PENDING', serviceId: 's1', customer: { userId: 'customer-user' }, offers: options.offers ?? [] };
  const tx = {
    $queryRaw: jest.fn(),
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    providerProfile: { findMany: jest.fn().mockResolvedValue((options.eligible ?? ['p1', 'p2', 'p3']).map((id) => ({ id }))) },
    orderOffer: { createMany: jest.fn(), updateMany: jest.fn() },
  };
  const providerProfile = { findMany: tx.providerProfile.findMany, findUnique: jest.fn() };
  const prisma = {
    ...tx,
    providerProfile,
    orderOffer: { ...tx.orderOffer, findUnique: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { service: new OrderDispatchService(prisma as never), tx, prisma };
}

describe('OrderDispatchService', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(NOW); });
  afterEach(() => jest.useRealTimers());

  describe('who is eligible', () => {
    it('asks only providers with the skill who are free, unblocked and not the customer', async () => {
      const { service, tx } = build();
      await service.dispatchNextWave('o1');
      const where = tx.providerProfile.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ isAvailable: true, isBlockedForNegative: false });
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
});

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrderAssignmentService } from './order-assignment.service';

const order = { referenceCode: 'ABC123', orderStatus: 'PENDING', serviceId: 's1', service: { name: 'AC Repair' }, customer: { userId: 'customer-user' }, bookingDetail: { districtId: 1, upazilaId: 10 } };

const goodProvider = {
  id: 'p1',
  isAvailable: true,
  isBlockedForNegative: false,
  user: { id: 'provider-user', status: 'ACTIVE', isRestricted: false, serviceAssignments: [{ id: 'sa1' }] },
};

function build(options: { order?: Partial<typeof order> | null; provider?: unknown } = {}) {
  const tx = {
    $queryRaw: jest.fn(),
    order: { findUnique: jest.fn().mockResolvedValue(options.order === null ? null : { ...order, ...options.order }), update: jest.fn() },
    providerProfile: { findUnique: jest.fn().mockResolvedValue(options.provider === undefined ? goodProvider : options.provider) },
    orderOffer: { updateMany: jest.fn(), aggregate: jest.fn().mockResolvedValue({ _max: { wave: 2 } }), upsert: jest.fn() },
    orderAssignmentLog: { create: jest.fn() },
  };
  const prisma = { ...tx, $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)) };
  const dispatch = { closeOffersAfterAcceptance: jest.fn() };
  const events = { publishToUser: jest.fn() };
  return { service: new OrderAssignmentService(prisma as never, dispatch as never, events as never), tx, prisma, dispatch, events };
}

const admin = { id: 'admin-1' };

describe('OrderAssignmentService.assign', () => {
  it('OFFER: withdraws everyone else, offers it to this provider alone and tells their app', async () => {
    const { service, tx, events } = build();
    await service.assign(admin, 'o1', 'p1', 'OFFER');
    expect(tx.orderOffer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ providerId: { not: 'p1' } }), data: expect.objectContaining({ status: 'WITHDRAWN' }) }));
    expect(tx.orderOffer.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: 'OFFERED', wave: 3 }) }));
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(events.publishToUser).toHaveBeenCalledWith('provider-user', 'orderOffer', expect.objectContaining({ orderId: 'o1', serviceName: 'AC Repair' }));
    expect(tx.orderAssignmentLog.create).toHaveBeenCalledWith({ data: { orderId: 'o1', actorId: 'admin-1', providerId: 'p1', mode: 'OFFER' } });
  });

  it('ASSIGN: the order becomes theirs and the work starts, and the other offers are closed', async () => {
    const { service, tx, dispatch, events } = build();
    await service.assign(admin, 'o1', 'p1', 'ASSIGN');
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: expect.objectContaining({ providerId: 'p1', orderStatus: 'IN_PROGRESS', acceptedAt: expect.any(Date) }) });
    expect(dispatch.closeOffersAfterAcceptance).toHaveBeenCalledWith(tx, 'o1', 'p1');
    expect(events.publishToUser).toHaveBeenCalledWith('provider-user', 'orderAssigned', expect.any(Object));
  });

  it('only works while nobody has taken the order', async () => {
    const { service, tx, events } = build({ order: { orderStatus: 'ACCEPTED' } });
    await expect(service.assign(admin, 'o1', 'p1', 'ASSIGN')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(events.publishToUser).not.toHaveBeenCalled();
  });

  it('turns away a provider who dispatch would never ask', async () => {
    const cases: Array<[string, unknown]> = [
      ['blocked', { ...goodProvider, user: { ...goodProvider.user, status: 'SUSPENDED' } }],
      ['restricted', { ...goodProvider, user: { ...goodProvider.user, isRestricted: true } }],
      ['wallet', { ...goodProvider, isBlockedForNegative: true }],
      ['unavailable', { ...goodProvider, isAvailable: false }],
      ['no skill', { ...goodProvider, user: { ...goodProvider.user, serviceAssignments: [] } }],
      ['the customer', { ...goodProvider, user: { ...goodProvider.user, id: 'customer-user' } }],
    ];
    for (const [, provider] of cases) {
      const { service, tx } = build({ provider });
      await expect(service.assign(admin, 'o1', 'p1', 'ASSIGN')).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.order.update).not.toHaveBeenCalled();
    }
  });

  it('answers 404 for a missing order or provider', async () => {
    await expect(build({ order: null }).service.assign(admin, 'o1', 'p1', 'OFFER')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ provider: null }).service.assign(admin, 'o1', 'p1', 'OFFER')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not undo the assignment when the notification fails', async () => {
    const { service, events } = build();
    events.publishToUser.mockImplementation(() => {
      throw new Error('socket down');
    });
    await expect(service.assign(admin, 'o1', 'p1', 'ASSIGN')).resolves.toMatchObject({ mode: 'ASSIGN' });
  });
});

describe('OrderAssignmentService.listAssignable', () => {
  it('puts providers who can take it and cover the place first, and says why the others cannot', async () => {
    const { service, prisma } = build();
    const row = (id: string, over: Record<string, unknown>, areas: Array<{ districtId: number; upazilaId: number }>) => ({
      ...goodProvider, id, companyName: id, rating: 4, user: { ...goodProvider.user, id: `u-${id}`, ...(over.user as object) }, isAvailable: over.isAvailable ?? true, serviceAreas: areas, orderOffers: [],
    });
    (prisma as unknown as { providerProfile: { findMany: jest.Mock } }).providerProfile.findMany = jest.fn().mockResolvedValue([
      row('far', {}, [{ districtId: 2, upazilaId: 99 }]),
      row('blocked', { user: { status: 'BANNED' } }, [{ districtId: 1, upazilaId: 10 }]),
      row('near', {}, [{ districtId: 1, upazilaId: 10 }]),
      row('district', {}, [{ districtId: 1, upazilaId: 11 }]),
    ]);
    (prisma as unknown as { order: { findUnique: jest.Mock } }).order.findUnique = jest.fn().mockResolvedValue(order);
    const rows = await service.listAssignable('o1');
    expect(rows.map((r) => r.id)).toEqual(['near', 'district', 'far', 'blocked']);
    expect(rows.find((r) => r.id === 'blocked')).toMatchObject({ canAssign: false, blockedReason: 'Banned' });
    expect(rows.find((r) => r.id === 'near')).toMatchObject({ canAssign: true, coversUpazila: true });
    expect(rows.find((r) => r.id === 'district')).toMatchObject({ coversUpazila: false, coversDistrict: true });
  });
});

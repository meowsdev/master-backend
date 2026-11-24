import { OrderExtraChargeService } from './order-extra-charge.service';

const CUSTOMER = { id: 'customer-user', role: 'CUSTOMER' as const };

function build() {
  const request = { id: 'r1', orderId: 'o1', totalAmount: 1600, status: 'PENDING' };
  const tx = {
    extraChargeRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue(request) },
    // The order's own commission percent (the provider's when they got it).
    order: { update: jest.fn(), findUniqueOrThrow: jest.fn().mockResolvedValue({ commissionRate: 10 }) },
  };
  const prisma = {
    extraChargeRequest: { findUnique: jest.fn().mockResolvedValue(request) },
    order: { findUnique: jest.fn().mockResolvedValue({ id: 'o1', orderStatus: 'IN_PROGRESS', totalPrice: 2100, priceEditCount: 0, customer: { userId: CUSTOMER.id }, provider: { userId: 'p' }, technician: null }) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { service: new OrderExtraChargeService(prisma as never), tx };
}

describe('OrderExtraChargeService.list', () => {
  it('lets an admin read the requests but not a stranger', async () => {
    const { service } = build();
    const prisma = (service as unknown as { prisma: { extraChargeRequest: { findMany: jest.Mock } } }).prisma;
    prisma.extraChargeRequest.findMany = jest.fn().mockResolvedValue([]);
    await expect(service.list('o1', { id: 'admin', role: 'ADMIN' })).resolves.toEqual([]);
    await expect(service.list('o1', { id: 'stranger', role: 'CUSTOMER' })).rejects.toThrow('not part of this order');
  });
});

describe('OrderExtraChargeService.respond', () => {
  it('adds the approved amount to the bill and to the platform commission', async () => {
    const { service, tx } = build();
    await service.respond('r1', 'APPROVED', CUSTOMER);
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ additionalPrice: { increment: 1600 }, adminCommission: { increment: 160 }, totalPrice: { increment: 1600 } }),
    }));
  });

  it('changes nothing on the order when rejected', async () => {
    const { service, tx } = build();
    await service.respond('r1', 'REJECTED', CUSTOMER);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});

describe('extra bill for a customer who does not use the app', () => {
  const NOW = new Date('2026-11-22T10:00:00.000Z');
  beforeEach(() => { jest.useFakeTimers().setSystemTime(NOW); });
  afterEach(() => jest.useRealTimers());

  function buildRequest(isVerified: boolean, { openRevision = null as { createdAt: Date } | null, priceEditCount = 0, approvedInRevision = 0 } = {}) {
    const order = { id: 'o1', orderStatus: 'IN_PROGRESS', totalPrice: 2100, priceEditCount, customer: { userId: CUSTOMER.id, user: { isVerified } }, provider: { userId: 'provider-user' }, technician: null };
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      serviceRevision: { findFirst: jest.fn().mockResolvedValue(openRevision) },
      orderPaymentAndTip: { findUnique: jest.fn().mockResolvedValue(null) },
      extraChargeRequest: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(approvedInRevision),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      },
    };
    return { service: new OrderExtraChargeService(prisma as never), prisma };
  }
  const dto = { items: [{ label: 'Gas refill', amount: 1600 }] };
  const provider = { id: 'provider-user', role: 'PROVIDER' as const };

  it('is set to approve itself after 15 minutes when the customer never signed in', async () => {
    const { service } = buildRequest(false);
    const created = await service.request('o1', dto, provider);
    expect(created.autoApproveAt).toEqual(new Date(NOW.getTime() + 15 * 60 * 1000));
  });

  it('allows extra charges during a warranty revision (parts are not covered)', async () => {
    const { service } = buildRequest(true, { openRevision: { createdAt: NOW }, priceEditCount: 2 });
    const created = await service.request('o1', dto, provider);
    expect(created.totalAmount).toBe(1600);
  });

  it('limits each revision to its own two price changes', async () => {
    const { service } = buildRequest(true, { openRevision: { createdAt: NOW }, approvedInRevision: 2 });
    await expect(service.request('o1', dto, provider)).rejects.toThrow('at most 2 times');
  });

  it('waits for the customer when they use the app', async () => {
    const { service } = buildRequest(true);
    const created = await service.request('o1', dto, provider);
    expect(created.autoApproveAt).toBeNull();
  });

  it('the timer approves only due requests of app-less customers, marks them automatic and bills them once', async () => {
    const { service, tx } = build();
    const prisma = (service as unknown as { prisma: { extraChargeRequest: { findMany: jest.Mock } } }).prisma;
    prisma.extraChargeRequest.findMany = jest.fn().mockResolvedValue([{ id: 'r1', orderId: 'o1', totalAmount: 1600 }]);

    await expect(service.autoApproveDue(NOW)).resolves.toBe(1);
    expect(prisma.extraChargeRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'PENDING', autoApproveAt: { lte: NOW }, order: { orderStatus: 'IN_PROGRESS', customer: { user: { isVerified: false } } } }),
    }));
    expect(tx.extraChargeRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', isAutoApproved: true }) }));
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalPrice: { increment: 1600 } }) }));
  });

  it('skips a request the customer answered a moment earlier', async () => {
    const { service, tx } = build();
    const prisma = (service as unknown as { prisma: { extraChargeRequest: { findMany: jest.Mock } } }).prisma;
    prisma.extraChargeRequest.findMany = jest.fn().mockResolvedValue([{ id: 'r1', orderId: 'o1', totalAmount: 1600 }]);
    tx.extraChargeRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.autoApproveDue(NOW)).resolves.toBe(0);
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});

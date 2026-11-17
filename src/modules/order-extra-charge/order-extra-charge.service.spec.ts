import { OrderExtraChargeService } from './order-extra-charge.service';

const CUSTOMER = { id: 'customer-user', role: 'CUSTOMER' as const };

function build() {
  const request = { id: 'r1', orderId: 'o1', totalAmount: 1600, status: 'PENDING' };
  const tx = {
    extraChargeRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue(request) },
    order: { update: jest.fn() },
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

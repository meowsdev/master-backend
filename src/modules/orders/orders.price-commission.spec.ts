import { OrdersService } from './orders.service';

/** A 30% provider's order, first priced at ৳2000 (commission ৳600). */
function build() {
  const order = {
    id: 'o1',
    orderStatus: 'IN_PROGRESS',
    originalPrice: 2000,
    additionalPrice: 0,
    adminCommission: 600,
    commissionRate: 30,
    advancePaid: 0,
    priceEditCount: 0,
    completedAt: null,
    providerId: 'p1',
  };
  const tx = { order: { update: jest.fn().mockResolvedValue(order) } };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order), update: jest.fn().mockResolvedValue(order) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { service: new OrdersService(prisma as never, {} as never), prisma, tx };
}

const admin = { id: 'admin', role: 'ADMIN' as never };
const dataOf = (mock: jest.Mock) => mock.mock.calls[0][0].data;

describe("an order's commission follows its price", () => {
  it('works the commission out again at the order percent when the price changes', async () => {
    const { service, tx } = build();
    await service.update('o1', { originalPrice: 5000 } as never, admin);
    // 30% of ৳5000, not the ৳600 of the old price (which expense approval would read as 12%).
    expect(dataOf(tx.order.update)).toMatchObject({ originalPrice: 5000, totalPrice: 5000, adminCommission: 1500 });
  });

  it('counts an extra price in the commission too', async () => {
    const { service, tx } = build();
    await service.update('o1', { additionalPrice: 1000 } as never, admin);
    expect(dataOf(tx.order.update)).toMatchObject({ totalPrice: 3000, adminCommission: 900 });
  });

  it('keeps a commission amount an admin typed in', async () => {
    const { service, tx } = build();
    await service.update('o1', { originalPrice: 5000, adminCommission: 700 } as never, admin);
    expect(dataOf(tx.order.update)).toMatchObject({ adminCommission: 700 });
  });

  it('leaves the commission alone when the price is not touched', async () => {
    const { service, tx } = build();
    await service.update('o1', { paymentStatus: 'PAID' } as never, admin);
    expect(dataOf(tx.order.update)).toMatchObject({ adminCommission: 600 });
  });

  it("drops the extra price's commission when the extra price is rejected", async () => {
    const { service, prisma } = build();
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', originalPrice: 2000, additionalPrice: 1000, adminCommission: 900, commissionRate: 30, advancePaid: 0 });
    await service.rejectPrice('o1');
    expect(dataOf(prisma.order.update)).toMatchObject({ totalPrice: 2000, additionalPrice: 0, adminCommission: 600 });
  });
});

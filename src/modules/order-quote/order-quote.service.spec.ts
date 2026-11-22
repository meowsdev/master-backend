import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { acceptedQuotePrices, OrderQuoteService } from './order-quote.service';

const order = (overrides: Record<string, unknown> = {}) => ({
  id: 'o1',
  orderStatus: 'ACCEPTED',
  isPricePending: true,
  advancePaid: 0,
  customer: { userId: 'cust' },
  provider: { userId: 'prov' },
  technician: null,
  ...overrides,
});

function setup(
  orderRow = order(),
  quote: Record<string, unknown> | null = {
    id: 'q1',
    orderId: 'o1',
    totalAmount: 2000,
  },
  claimed = 1,
) {
  const tx = {
    orderQuote: {
      updateMany: jest.fn().mockResolvedValue({ count: claimed }),
      create: jest
        .fn()
        .mockImplementation(({ data }) => ({ id: 'q-new', ...data })),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'q1' }),
    },
    order: { update: jest.fn() },
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(orderRow) },
    orderQuote: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue(quote),
    },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { service: new OrderQuoteService(prisma as never), prisma, tx };
}

describe('OrderQuoteService', () => {
  const provider = { id: 'prov', role: 'PROVIDER' as never };
  const customer = { id: 'cust', role: 'CUSTOMER' as never };
  const items = [
    { label: 'Labour', amount: 1500 },
    { label: 'Parts', amount: 500 },
  ];

  it('lets the provider price an accepted custom order, replacing an unanswered price', async () => {
    const { service, tx } = setup();
    const created = await service.send('o1', { items }, provider);
    expect(created).toMatchObject({ totalAmount: 2000, requestedById: 'prov' });
    expect(tx.orderQuote.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: 'o1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'REPLACED' }),
      }),
    );
  });

  it('refuses a price from anyone else, for a priced order, or before the provider takes it', async () => {
    await expect(
      setup().service.send('o1', { items }, customer),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      setup(order({ isPricePending: false })).service.send(
        'o1',
        { items },
        provider,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup(order({ orderStatus: 'PENDING' })).service.send(
        'o1',
        { items },
        provider,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prices the order when the customer accepts', async () => {
    const { service, tx } = setup();
    await service.respond('q1', 'ACCEPTED', customer);
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: acceptedQuotePrices(2000, 0),
    });
  });

  it('cancels the order when the customer rejects', async () => {
    const { service, tx } = setup();
    await service.respond('q1', 'REJECTED', customer);
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'o1' },
      data: { orderStatus: 'CANCELLED' },
    });
  });

  it('answers only once and only as the customer', async () => {
    await expect(
      setup(order(), undefined, 0).service.respond('q1', 'ACCEPTED', customer),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup().service.respond('q1', 'ACCEPTED', provider),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('works out the accepted price fields', () => {
    expect(acceptedQuotePrices(2000, 500)).toMatchObject({
      isPricePending: false,
      originalPrice: 2000,
      totalPrice: 2000,
      dueAmount: 1500,
    });
  });
});

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrderCompletionService } from './order-completion.service';
import { PaymentGateway } from './payment-gateway';

const PROVIDER = { id: 'provider-user', role: 'PROVIDER' as const };
const CUSTOMER = { id: 'customer-user', role: 'CUSTOMER' as const };

function build(orderOverrides: Record<string, unknown> = {}) {
  const order = {
    id: 'order-1',
    orderStatus: 'IN_PROGRESS',
    totalPrice: 2900,
    advancePaid: 0,
    dueAmount: 2900,
    adminCommission: 290,
    providerId: 'provider-profile',
    customer: { userId: CUSTOMER.id },
    provider: { userId: PROVIDER.id },
    technician: null,
    paymentAndTip: null,
    ...orderOverrides,
  };
  const tx = {
    serviceRevision: { updateMany: jest.fn() },
    orderPaymentAndTip: { upsert: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    order: { update: jest.fn() },
    providerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'provider-profile', walletBalance: 1000 }), update: jest.fn() },
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    orderPaymentAndTip: { upsert: jest.fn().mockResolvedValue({ paymentMode: 'ONLINE' }) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const gateway = { charge: jest.fn().mockResolvedValue({ success: true, transactionId: 'T1' }) };
  const service = new OrderCompletionService(prisma as never, gateway as unknown as PaymentGateway);
  return { service, prisma, tx, gateway };
}

describe('OrderCompletionService', () => {
  it('lets only the provider handling the order complete it', async () => {
    const { service } = build();
    await expect(service.complete('order-1', { paymentMode: 'CASH' }, CUSTOMER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('completes a cash order at once and settles the bill', async () => {
    const { service, tx } = build();
    await service.complete('order-1', { paymentMode: 'CASH' }, PROVIDER);
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderStatus: 'COMPLETED', paymentStatus: 'PAID', dueAmount: 0 }) }));
    // COD: the platform commission leaves the provider's wallet.
    expect(tx.providerProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ walletBalance: 710 }) }));
  });

  it('only records an online request and leaves the order running', async () => {
    const { service, prisma, tx } = build();
    await service.complete('order-1', { paymentMode: 'ONLINE' }, PROVIDER);
    expect(prisma.orderPaymentAndTip.upsert).toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  it('records the tip the provider reports on a cash job', async () => {
    const { service, tx } = build();
    await service.complete('order-1', { paymentMode: 'CASH', tipAmount: 80 }, PROVIDER);
    expect(tx.orderPaymentAndTip.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ tipAmount: 80, hasTip: true }) }));
  });

  it('does not take a reported tip for an online payment', async () => {
    const { service } = build();
    await expect(service.complete('order-1', { paymentMode: 'ONLINE', tipAmount: 80 }, PROVIDER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a second completion while the customer has not paid', async () => {
    const { service } = build({ paymentAndTip: { paymentMode: 'ONLINE', confirmationStatus: 'PENDING' } });
    await expect(service.complete('order-1', { paymentMode: 'CASH' }, PROVIDER)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses payment from anyone but the customer', async () => {
    const { service } = build({ paymentAndTip: { paymentMode: 'ONLINE', confirmationStatus: 'PENDING' } });
    await expect(service.payOnline('order-1', { method: 'BKASH' }, PROVIDER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses payment when no online payment was requested', async () => {
    const { service } = build();
    await expect(service.payOnline('order-1', { method: 'BKASH' }, CUSTOMER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('charges due + tip, completes the order and keeps the wallet untouched', async () => {
    const { service, gateway, tx } = build({ paymentAndTip: { paymentMode: 'ONLINE', confirmationStatus: 'PENDING' } });
    await service.payOnline('order-1', { method: 'NAGAD', tipAmount: 100 }, CUSTOMER);
    expect(gateway.charge).toHaveBeenCalledWith({ method: 'NAGAD', amount: 3000, orderId: 'order-1' });
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderStatus: 'COMPLETED' }) }));
    // Online: only the completed-orders counter moves, no commission deduction.
    expect(tx.providerProfile.update).toHaveBeenCalledWith({ where: { id: 'provider-profile' }, data: { totalCompletedOrders: { increment: 1 } } });
  });

  it('does not complete twice when the payment was already claimed', async () => {
    const { service, tx } = build({ paymentAndTip: { paymentMode: 'ONLINE', confirmationStatus: 'PENDING' } });
    tx.orderPaymentAndTip.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.payOnline('order-1', { method: 'BKASH' }, CUSTOMER)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.order.update).not.toHaveBeenCalled();
  });

  describe('revision (7-day warranty)', () => {
    const inRevision = { revisions: [{ revisionStatus: 'REQUESTED' }], paymentAndTip: { paymentMode: 'CASH' } };

    it('closes the revision and the order again without a new payment or commission', async () => {
      const { service, tx } = build(inRevision);
      await service.finishRevision('order-1', PROVIDER);
      expect(tx.serviceRevision.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { revisionStatus: 'COMPLETED' } }));
      expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: { orderStatus: 'COMPLETED' } }));
      expect(tx.orderPaymentAndTip.upsert).not.toHaveBeenCalled();
      expect(tx.providerProfile.update).not.toHaveBeenCalled();
    });

    it('lets only the provider handling the order finish it', async () => {
      const { service } = build(inRevision);
      await expect(service.finishRevision('order-1', CUSTOMER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses when there is no revision in progress', async () => {
      const { service } = build({ revisions: [] });
      await expect(service.finishRevision('order-1', PROVIDER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('will not bill an order in revision a second time through Work Complete', async () => {
      const { service } = build(inRevision);
      await expect(service.complete('order-1', { paymentMode: 'CASH' }, PROVIDER)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});

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
    customer: { userId: CUSTOMER.id, user: { isVerified: true } },
    provider: { userId: PROVIDER.id },
    technician: null,
    paymentAndTip: null,
    ...orderOverrides,
  };
  const tx = {
    serviceRevision: { updateMany: jest.fn() },
    orderPaymentAndTip: { upsert: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    order: { update: jest.fn() },
    extraChargeRequest: { findMany: jest.fn().mockResolvedValue([]) },
    providerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'provider-profile', walletBalance: 1000 }), update: jest.fn() },
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    orderPaymentAndTip: { upsert: jest.fn().mockResolvedValue({ paymentMode: 'ONLINE' }) },
    extraChargeRequest: { count: jest.fn().mockResolvedValue(0) },
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

  it('refuses online payment for a customer who never verified their number by OTP', async () => {
    const { service, prisma } = build({ customer: { userId: CUSTOMER.id, user: { isVerified: false } } });
    await expect(service.complete('order-1', { paymentMode: 'ONLINE' }, PROVIDER)).rejects.toThrow('cannot pay online');
    expect(prisma.orderPaymentAndTip.upsert).not.toHaveBeenCalled();
  });

  it('still completes a cash job for a customer who never verified', async () => {
    const { service, tx } = build({ customer: { userId: CUSTOMER.id, user: { isVerified: false } } });
    await service.complete('order-1', { paymentMode: 'CASH' }, PROVIDER);
    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderStatus: 'COMPLETED' }) }));
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
    const revisionStart = new Date('2026-11-20T10:00:00.000Z');
    const firstCompletion = new Date('2026-11-18T10:00:00.000Z');
    const inRevision = {
      revisions: [{ revisionStatus: 'REQUESTED', createdAt: revisionStart }],
      paymentAndTip: { paymentMode: 'CASH', tipAmount: 50 },
      completedAt: firstCompletion,
      dueAmount: 0,
      advancePaid: 2900,
    };
    const finishDto = { reason: 'Gas leak missed in the first service', wasQualityIssue: true };

    it('closes the revision and the order again without a new payment or commission, keeping the reason', async () => {
      const { service, tx } = build(inRevision);
      await service.finishRevision('order-1', finishDto, PROVIDER);
      expect(tx.serviceRevision.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { completionReason: finishDto.reason, wasQualityIssue: true } }),
      );
      expect(tx.serviceRevision.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ revisionStatus: 'COMPLETED' }) }),
      );
      expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: { orderStatus: 'COMPLETED' } }));
      expect(tx.orderPaymentAndTip.upsert).not.toHaveBeenCalled();
      expect(tx.providerProfile.update).not.toHaveBeenCalled();
    });

    it('asks how the customer pays when extra charges were added during the revision', async () => {
      const { service } = build({ ...inRevision, dueAmount: 1500, totalPrice: 4400 });
      await expect(service.finishRevision('order-1', finishDto, PROVIDER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('settles revision extras in cash: only their commission, warranty clock and tip kept', async () => {
      const { service, tx } = build({ ...inRevision, dueAmount: 1500, totalPrice: 4400, adminCommission: 440 });
      tx.extraChargeRequest.findMany.mockResolvedValue([{ totalAmount: 1500 }]);
      await service.finishRevision('order-1', { ...finishDto, paymentMode: 'CASH' }, PROVIDER);

      expect(tx.extraChargeRequest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ createdAt: { gte: revisionStart } }) }),
      );
      // 10% of 1500 only; the first job's 290 was taken at the first completion.
      expect(tx.providerProfile.update).toHaveBeenCalledTimes(1);
      expect(tx.providerProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ walletBalance: 850 }) }));
      const orderData = tx.order.update.mock.calls[0][0].data;
      expect(orderData).toEqual(expect.objectContaining({ orderStatus: 'COMPLETED', dueAmount: 0, paymentStatus: 'PAID' }));
      expect(orderData.completedAt).toBeUndefined();
      expect(tx.orderPaymentAndTip.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ tipAmount: 50 }) }));
    });

    it('sends revision extras to the customer to pay online and keeps the order running', async () => {
      const { service, tx } = build({ ...inRevision, dueAmount: 1500, totalPrice: 4400 });
      await service.finishRevision('order-1', { ...finishDto, paymentMode: 'ONLINE' }, PROVIDER);
      expect(tx.orderPaymentAndTip.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paymentMode: 'ONLINE' }) }));
      expect(tx.order.update).not.toHaveBeenCalled();
    });

    it('will not finish while an extra-charge request is unanswered', async () => {
      const { service, prisma } = build(inRevision);
      prisma.extraChargeRequest.count.mockResolvedValue(1);
      await expect(service.finishRevision('order-1', finishDto, PROVIDER)).rejects.toBeInstanceOf(ConflictException);
    });

    it('lets only the provider handling the order finish it', async () => {
      const { service } = build(inRevision);
      await expect(service.finishRevision('order-1', finishDto, CUSTOMER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses when there is no revision in progress', async () => {
      const { service } = build({ revisions: [] });
      await expect(service.finishRevision('order-1', finishDto, PROVIDER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('will not bill an order in revision a second time through Work Complete', async () => {
      const { service } = build(inRevision);
      await expect(service.complete('order-1', { paymentMode: 'CASH' }, PROVIDER)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrderAdvancePaymentService } from './order-advance-payment.service';

const CUSTOMER = { id: 'customer-user', role: 'CUSTOMER' as const };

function build(overrides: Record<string, unknown> = {}, updateCount = 1) {
  const order = { id: 'o1', orderStatus: 'IN_PROGRESS', dueAmount: 3700, advancePaid: 0, customer: { userId: CUSTOMER.id }, ...overrides };
  const tx = { order: { updateMany: jest.fn().mockResolvedValue({ count: updateCount }) }, orderAdvancePayment: { create: jest.fn() } };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(order) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const gateway = { charge: jest.fn().mockResolvedValue({ success: true, transactionId: 'T1' }) };
  return { service: new OrderAdvancePaymentService(prisma as never, gateway as never), tx, gateway };
}

describe('OrderAdvancePaymentService', () => {
  it('lets only the order customer pay', async () => {
    const { service } = build();
    await expect(service.pay('o1', { amount: 500, method: 'BKASH' }, { id: 'other', role: 'CUSTOMER' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(['PENDING', 'COMPLETED', 'CANCELLED'])('refuses an advance on a %s order', async (orderStatus) => {
    const { service, gateway } = build({ orderStatus });
    await expect(service.pay('o1', { amount: 500, method: 'BKASH' }, CUSTOMER)).rejects.toBeInstanceOf(BadRequestException);
    expect(gateway.charge).not.toHaveBeenCalled();
  });

  it('refuses more than what is due and never charges', async () => {
    const { service, gateway } = build();
    await expect(service.pay('o1', { amount: 4000, method: 'BKASH' }, CUSTOMER)).rejects.toBeInstanceOf(BadRequestException);
    expect(gateway.charge).not.toHaveBeenCalled();
  });

  it('lowers the due by exactly the amount and records the payment', async () => {
    const { service, tx } = build();
    const result = await service.pay('o1', { amount: 1000, method: 'NAGAD' }, CUSTOMER);
    expect(result).toEqual({ advancePaid: 1000, dueAmount: 2700 });
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dueAmount: 2700, paymentStatus: 'PARTIAL' }) }));
    expect(tx.orderAdvancePayment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: 1000, method: 'NAGAD' }) });
  });

  it('marks the order paid when the advance covers everything', async () => {
    const { service, tx } = build();
    await service.pay('o1', { amount: 3700, method: 'CARD' }, CUSTOMER);
    expect(tx.order.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dueAmount: 0, paymentStatus: 'PAID' }) }));
  });

  it('conflicts when the order changed while paying', async () => {
    const { service } = build({}, 0);
    await expect(service.pay('o1', { amount: 500, method: 'BKASH' }, CUSTOMER)).rejects.toBeInstanceOf(ConflictException);
  });
});

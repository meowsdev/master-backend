import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { assertProvider, handleCommissionBalance } from './orders.helpers';

const prismaWith = (walletBalance: number | null) => ({
  providerProfile: { findUnique: jest.fn().mockResolvedValue(walletBalance === null ? null : { id: 'p1', walletBalance }) },
});

describe('accepting an order with a negative wallet', () => {
  it('is refused until the previous due is cleared, naming the due', async () => {
    await expect(assertProvider(prismaWith(-250.5), 'p1')).rejects.toThrow(BadRequestException);
    await expect(assertProvider(prismaWith(-250.5), 'p1')).rejects.toThrow('Please clear your previous due of ৳251 first');
  });

  it('is allowed once the wallet is zero or positive', async () => {
    await expect(assertProvider(prismaWith(0), 'p1')).resolves.toBeUndefined();
    await expect(assertProvider(prismaWith(120), 'p1')).resolves.toBeUndefined();
  });
});

describe('commission when an order is completed again after a revision', () => {
  it('is not taken a second time', async () => {
    const tx = { providerProfile: { findUnique: jest.fn(), update: jest.fn() } };
    await handleCommissionBalance(tx, { orderStatus: 'IN_PROGRESS', adminCommission: 290, providerId: 'p1', completedAt: new Date() }, 'COMPLETED');
    expect(tx.providerProfile.update).not.toHaveBeenCalled();
  });
});

describe('placing an order while the only matching provider owes a due', () => {
  it('still creates the order and offers it (the due only blocks accepting)', async () => {

    const created = { id: 'o1' };
    const prisma = {
      service: { findUnique: jest.fn().mockResolvedValue({ id: 's1', isActive: true, isDeleted: false }), findFirst: jest.fn().mockResolvedValue({ id: 's1', isActive: true, isDeleted: false }) },
      customerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', userId: 'u-c', user: { isRestricted: false } }) },
      providerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', walletBalance: -150 }) },
      order: { create: jest.fn().mockResolvedValue(created), findUnique: jest.fn().mockResolvedValue(null) },
    };
    const dispatch = { findEligibleProviderIds: jest.fn().mockResolvedValue(['p1']), dispatchNextWave: jest.fn().mockResolvedValue(1) };
    const service = new OrdersService(prisma as never, dispatch as never);
    await expect(service.create({ serviceId: 's1', customerId: 'c1', originalPrice: 1500 } as never, { id: 'u-admin', role: 'ADMIN' as never })).resolves.toBe(created);
    expect(dispatch.dispatchNextWave).toHaveBeenCalledWith('o1', undefined);
  });
});

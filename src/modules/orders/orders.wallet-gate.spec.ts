import { BadRequestException } from '@nestjs/common';
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

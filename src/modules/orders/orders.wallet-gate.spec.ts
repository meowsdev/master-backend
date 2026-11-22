import { BadRequestException } from '@nestjs/common';
import { assertProvider } from './orders.helpers';

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

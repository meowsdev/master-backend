import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ProviderWithdrawalService } from './provider-withdrawal.service';
import { withdrawableFrom } from './wallet-ledger';

const bkash = { amount: 1000, method: 'BKASH' as const, accountNumber: ' 01712345678 ', accountName: ' Rahim ' };

function build({ balance = 3000, clearing = 0, openRequests = 0, held = 1, request = { id: 'w1', providerId: 'p1', amount: 1000, status: 'PENDING' } as Record<string, unknown> | null, claimed = 1 } = {}) {
  const tx = {
    withdrawalRequest: {
      count: jest.fn().mockResolvedValue(openRequests),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'w1', ...data })),
      findFirst: jest.fn().mockResolvedValue(request),
      updateMany: jest.fn().mockResolvedValue({ count: claimed }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(request),
    },
    walletCredit: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: clearing } }) },
    providerProfile: {
      updateMany: jest.fn().mockResolvedValue({ count: held }),
      update: jest.fn().mockResolvedValue({ walletBalance: balance + 1000 }),
    },
  };
  const prisma = {
    ...tx,
    providerProfile: { ...tx.providerProfile, findUnique: jest.fn().mockResolvedValue({ id: 'p1', walletBalance: balance }) },
    withdrawalRequest: { ...tx.withdrawalRequest, aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { service: new ProviderWithdrawalService(prisma as never), tx, prisma };
}

describe('withdrawable balance', () => {
  it('is the balance less what is still clearing, never below zero', () => {
    expect(withdrawableFrom(3000, 0)).toBe(3000);
    expect(withdrawableFrom(3000, 1200)).toBe(1800);
    expect(withdrawableFrom(1000, 1200)).toBe(0);
    expect(withdrawableFrom(-400, 0)).toBe(0);
  });
});

describe('ProviderWithdrawalService', () => {
  it('holds the amount out of the wallet only if the cleared balance covers it, and records the request', async () => {
    const { service, tx } = build({ clearing: 500 });
    const created = await service.request('user-1', bkash);
    // Atomic: the WHERE needs balance ≥ amount + still clearing, so two requests cannot take the same money.
    expect(tx.providerProfile.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', walletBalance: { gte: 1500 } }, data: { walletBalance: { decrement: 1000 } } });
    expect(created).toMatchObject({ providerId: 'p1', amount: 1000, method: 'BKASH', accountNumber: '01712345678', accountName: 'Rahim', bankName: null });
  });

  it('refuses more than the cleared balance', async () => {
    const { service, tx } = build({ held: 0 });
    await expect(service.request('user-1', bkash)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.withdrawalRequest.create).not.toHaveBeenCalled();
  });

  it('refuses less than the minimum', async () => {
    const { service } = build();
    await expect(service.request('user-1', { ...bkash, amount: 100 })).rejects.toThrow('smallest withdrawal');
  });

  it('allows one waiting request at a time', async () => {
    const { service, tx } = build({ openRequests: 1 });
    await expect(service.request('user-1', bkash)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.providerProfile.updateMany).not.toHaveBeenCalled();
  });

  it('gives the amount back when the provider cancels', async () => {
    const { service, tx } = build();
    await service.cancel('user-1', 'w1');
    expect(tx.withdrawalRequest.findFirst).toHaveBeenCalledWith({ where: { id: 'w1', providerId: 'p1' } });
    expect(tx.providerProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { walletBalance: { increment: 1000 } } }));
  });

  it("cannot cancel another provider's request", async () => {
    const { service } = build({ request: null });
    await expect(service.cancel('user-1', 'w1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marks paid without touching the wallet (the amount was held when asked)', async () => {
    const { service, tx } = build();
    await service.markPaid('w1', 'admin-1', ' TRX123 ');
    expect(tx.withdrawalRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'w1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'PAID', transactionRef: 'TRX123', reviewedById: 'admin-1' }),
    });
    expect(tx.providerProfile.update).not.toHaveBeenCalled();
  });

  it('gives the amount back on rejection', async () => {
    const { service, tx } = build();
    await service.reject('w1', 'admin-1', 'Wrong number');
    expect(tx.withdrawalRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED', reviewNote: 'Wrong number' }) }));
    expect(tx.providerProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { walletBalance: { increment: 1000 } } }));
  });

  it('answers a request once', async () => {
    const { service, tx } = build({ claimed: 0 });
    await expect(service.reject('w1', 'admin-1', 'x')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.providerProfile.update).not.toHaveBeenCalled();
  });

  it('shows only what is still in the wallet as clearing', async () => {
    const { service } = build();
    // A due used part of the credit: 800 left in the wallet, 1200 still clearing.
    (service as unknown as { prisma: { walletCredit: { aggregate: jest.Mock } } }).prisma.walletCredit.aggregate.mockResolvedValue({ _sum: { amount: 1200 } });
    await expect(service.balance('p1', 800)).resolves.toMatchObject({ availableForWithdrawal: 0, pendingClearance: 800, minWithdrawal: 500 });
  });
});

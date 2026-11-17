import { BadRequestException } from '@nestjs/common';
import { ProviderWalletService } from './provider-wallet.service';

function build(walletBalance: number) {
  const tx = { providerProfile: { update: jest.fn().mockResolvedValue({ walletBalance: 0 }) } };
  const prisma = {
    providerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'p1', walletBalance }) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const gateway = { charge: jest.fn().mockResolvedValue({ success: true, transactionId: 'T' }) };
  return { service: new ProviderWalletService(prisma as never, gateway as never), gateway, tx };
}

describe('ProviderWalletService', () => {
  it('reports a negative wallet as a due', async () => {
    const { service } = build(-750);
    expect(await service.summary('u1')).toEqual({ walletBalance: -750, dueAmount: 750 });
  });

  it('reports no due for a positive wallet', async () => {
    const { service } = build(300);
    expect((await service.summary('u1')).dueAmount).toBe(0);
  });

  it('refuses to charge when nothing is due', async () => {
    const { service, gateway } = build(300);
    await expect(service.payDue('u1', 'BKASH')).rejects.toBeInstanceOf(BadRequestException);
    expect(gateway.charge).not.toHaveBeenCalled();
  });

  it('charges exactly the due and adds it back to the wallet', async () => {
    const { service, gateway, tx } = build(-750);
    await service.payDue('u1', 'NAGAD');
    expect(gateway.charge).toHaveBeenCalledWith({ method: 'NAGAD', amount: 750, orderId: 'wallet-p1' });
    expect(tx.providerProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { walletBalance: { increment: 750 } } }));
  });
});

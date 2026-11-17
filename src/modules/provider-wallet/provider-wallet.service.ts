import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentGateway } from '../order-completion/payment-gateway';

type DueMethod = 'BKASH' | 'NAGAD' | 'CARD';

@Injectable()
export class ProviderWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
  ) {}

  private async loadProvider(userId: string) {
    const provider = await this.prisma.providerProfile.findUnique({
      where: { userId },
      select: { id: true, walletBalance: true },
    });
    if (!provider) throw new NotFoundException('Provider profile not found');
    return provider;
  }

  /** A negative wallet is money the provider owes the platform (commission on cash jobs). */
  private toSummary(walletBalance: unknown) {
    const balance = Number(walletBalance);
    return { walletBalance: balance, dueAmount: balance < 0 ? -balance : 0 };
  }

  async summary(userId: string) {
    const provider = await this.loadProvider(userId);
    return this.toSummary(provider.walletBalance);
  }

  /** Pays the whole outstanding due. Nothing due means nothing to charge. */
  async payDue(userId: string, method: DueMethod) {
    const provider = await this.loadProvider(userId);
    const { dueAmount } = this.toSummary(provider.walletBalance);
    if (dueAmount <= 0) throw new BadRequestException('You have no due to pay');

    const result = await this.gateway.charge({ method, amount: dueAmount, orderId: `wallet-${provider.id}` });
    if (!result.success) throw new BadRequestException('The payment was not completed');

    return this.prisma.$transaction(async (tx) => {
      // Adding the exact due (not "set to 0") keeps this correct if the balance moved during the charge.
      const updated = await tx.providerProfile.update({
        where: { id: provider.id },
        data: { walletBalance: { increment: dueAmount } },
        select: { walletBalance: true },
      });
      const isBlocked = Number(updated.walletBalance) < 0;
      await tx.providerProfile.update({ where: { id: provider.id }, data: { isBlockedForNegative: isBlocked, isAvailable: !isBlocked } });
      return this.toSummary(updated.walletBalance);
    });
  }
}

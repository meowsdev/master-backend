import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, WithdrawalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestWithdrawalDto } from './dto/withdrawal.dto';
import { changeWalletBalance, clearanceDays, minWithdrawalAmount, pendingClearance, withdrawableFrom } from './wallet-ledger';

const PROVIDER_SELECT = {
  id: true,
  companyName: true,
  walletBalance: true,
  user: { select: { id: true, name: true, username: true, mobileNumber: true } },
} satisfies Prisma.ProviderProfileSelect;

/**
 * Provider withdrawals. Asking holds the amount out of the wallet at once (so it cannot be spent twice); an
 * admin then sends the money outside the app and marks it paid, or rejects it and the amount goes back.
 * The provider may cancel while it is still pending. One pending request at a time.
 */
@Injectable()
export class ProviderWithdrawalService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadProvider(userId: string) {
    const provider = await this.prisma.providerProfile.findUnique({ where: { userId }, select: { id: true, walletBalance: true } });
    if (!provider) throw new NotFoundException('Provider profile not found');
    return provider;
  }

  /** The numbers on the provider's withdraw card. */
  async balance(providerId: string, walletBalance: number, now = new Date()) {
    const [clearing, pending, paid] = await Promise.all([
      pendingClearance(this.prisma, providerId, now),
      this.prisma.withdrawalRequest.aggregate({ where: { providerId, status: WithdrawalStatus.PENDING }, _sum: { amount: true } }),
      this.prisma.withdrawalRequest.aggregate({ where: { providerId, status: WithdrawalStatus.PAID }, _sum: { amount: true } }),
    ]);
    return {
      availableForWithdrawal: withdrawableFrom(walletBalance, clearing),
      // Only what is still in the wallet: a due can already have used part of a credit.
      pendingClearance: Math.max(0, Math.min(clearing, walletBalance)),
      pendingWithdrawal: Number(pending._sum.amount ?? 0),
      withdrawn: Number(paid._sum.amount ?? 0),
      minWithdrawal: minWithdrawalAmount(),
      clearanceDays: clearanceDays(),
    };
  }

  async listMine(userId: string) {
    const provider = await this.loadProvider(userId);
    return this.prisma.withdrawalRequest.findMany({ where: { providerId: provider.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async request(userId: string, dto: RequestWithdrawalDto) {
    const provider = await this.loadProvider(userId);
    const minimum = minWithdrawalAmount();
    if (dto.amount < minimum) throw new BadRequestException(`The smallest withdrawal is ৳${minimum}`);

    return this.prisma.$transaction(async (tx) => {
      const open = await tx.withdrawalRequest.count({ where: { providerId: provider.id, status: WithdrawalStatus.PENDING } });
      if (open > 0) throw new ConflictException('You already have a withdrawal waiting. Wait for it, or cancel it first.');

      // Held out of the wallet only if the balance still covers it after what is clearing: the guard in the
      // WHERE makes two requests at once unable to take the same money.
      const clearing = await pendingClearance(tx, provider.id);
      const held = await tx.providerProfile.updateMany({
        where: { id: provider.id, walletBalance: { gte: dto.amount + clearing } },
        data: { walletBalance: { decrement: dto.amount } },
      });
      if (held.count === 0) throw new BadRequestException('Not enough balance available to withdraw');

      return tx.withdrawalRequest.create({
        data: {
          providerId: provider.id,
          amount: dto.amount,
          method: dto.method,
          accountNumber: dto.accountNumber.trim(),
          accountName: dto.accountName.trim(),
          bankName: dto.method === 'BANK' ? dto.bankName?.trim() : null,
          branchName: dto.method === 'BANK' ? dto.branchName?.trim() || null : null,
        },
      });
    });
  }

  async cancel(userId: string, withdrawalId: string) {
    const provider = await this.loadProvider(userId);
    return this.close(withdrawalId, { providerId: provider.id }, { status: WithdrawalStatus.CANCELLED }, true);
  }

  // ---- Admin ----

  listAll(status?: WithdrawalStatus) {
    return this.prisma.withdrawalRequest.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: status === WithdrawalStatus.PENDING ? 'asc' : 'desc' },
      take: 200,
      include: { provider: { select: PROVIDER_SELECT } },
    });
  }

  markPaid(withdrawalId: string, adminId: string, transactionRef: string, note?: string) {
    return this.close(
      withdrawalId,
      {},
      { status: WithdrawalStatus.PAID, transactionRef: transactionRef.trim(), reviewNote: note?.trim() || null, reviewedById: adminId, reviewedAt: new Date() },
      false,
    );
  }

  reject(withdrawalId: string, adminId: string, reason: string) {
    return this.close(
      withdrawalId,
      {},
      { status: WithdrawalStatus.REJECTED, reviewNote: reason.trim(), reviewedById: adminId, reviewedAt: new Date() },
      true,
    );
  }

  /** Answers a PENDING request once (a double click or two admins apply it once); a refused one gives the amount back. */
  private async close(withdrawalId: string, owner: { providerId?: string }, data: Prisma.WithdrawalRequestUpdateManyMutationInput, isReturned: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.withdrawalRequest.findFirst({ where: { id: withdrawalId, ...owner } });
      if (!request) throw new NotFoundException('Withdrawal not found');

      const claimed = await tx.withdrawalRequest.updateMany({ where: { id: withdrawalId, status: WithdrawalStatus.PENDING }, data });
      if (claimed.count === 0) throw new ConflictException('This withdrawal was already answered');

      if (isReturned) await changeWalletBalance(tx, request.providerId, Number(request.amount));
      return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: withdrawalId }, include: { provider: { select: PROVIDER_SELECT } } });
    });
  }
}

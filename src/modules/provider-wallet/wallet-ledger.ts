import { Prisma } from '@prisma/client';

/**
 * The provider's wallet in one number (ProviderProfile.walletBalance):
 *   + their share of online money (online advance, online payment, online tip) when an order is settled
 *   − the platform's commission on every settled order, cash or online
 *   − withdrawals (held when requested, given back if rejected or cancelled)
 *   + dues they paid off
 * Negative = they owe the platform (cash jobs' commission) and get no new orders. Positive = theirs to withdraw
 * once the clearance period of each credit has passed.
 */

type Tx = Prisma.TransactionClient;

/** Days an online credit waits before it can be withdrawn. Matches the 7-day warranty: a job can still come back. */
export const clearanceDays = () => {
  const days = Number(process.env.WALLET_CLEARANCE_DAYS);
  return Number.isFinite(days) && days >= 0 ? days : 7;
};

/** The smallest withdrawal, in taka. */
export const minWithdrawalAmount = () => Number(process.env.WITHDRAWAL_MIN_AMOUNT) || 500;

/** Moves the wallet by `delta` and keeps the negative-balance block in step with it. Returns the new balance. */
export async function changeWalletBalance(tx: Tx, providerId: string, delta: number): Promise<number> {
  const { walletBalance } = await tx.providerProfile.update({
    where: { id: providerId },
    data: { walletBalance: { increment: delta } },
    select: { walletBalance: true },
  });
  const balance = Number(walletBalance);
  await tx.providerProfile.update({ where: { id: providerId }, data: { isBlockedForNegative: balance < 0, isAvailable: balance >= 0 } });
  return balance;
}

/**
 * Online money of one settlement reaches the provider: the whole online amount goes into the wallet (the
 * commission leaves it separately), and the part left after commission is recorded as a credit that clears
 * after clearanceDays().
 */
export async function creditOnlineMoney(
  tx: Tx,
  input: { providerId: string; orderId: string; onlineAmount: number; commission: number; now?: Date },
): Promise<void> {
  if (input.onlineAmount <= 0) return;
  await changeWalletBalance(tx, input.providerId, input.onlineAmount);
  const net = input.onlineAmount - input.commission;
  if (net <= 0) return;
  const now = input.now ?? new Date();
  await tx.walletCredit.create({
    data: {
      providerId: input.providerId,
      orderId: input.orderId,
      amount: net,
      availableAt: new Date(now.getTime() + clearanceDays() * 24 * 60 * 60 * 1000),
    },
  });
}

/** Credits still in their clearance period: in the wallet, not yet withdrawable. */
export async function pendingClearance(client: Pick<Tx, 'walletCredit'>, providerId: string, now = new Date()): Promise<number> {
  const result = await client.walletCredit.aggregate({ where: { providerId, availableAt: { gt: now } }, _sum: { amount: true } });
  return Number(result._sum.amount ?? 0);
}

/** What the provider can withdraw now: the balance less what is still clearing. Never below zero. */
export function withdrawableFrom(walletBalance: number, clearing: number): number {
  return Math.max(0, Math.min(walletBalance, walletBalance - clearing));
}

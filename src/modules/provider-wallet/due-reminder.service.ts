import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { effectiveCommissionRate, readPlatformOrderCommission } from '../orders/orders.helpers';
import { USER_EVENT_PUBLISHER } from '../order-dispatch/user-events';
import type { UserEventPublisher } from '../order-dispatch/user-events';

/** Days between two automatic reminders to the same provider. */
export const reminderIntervalDays = () => Number(process.env.DUE_REMINDER_INTERVAL_DAYS) || 3;
/** The daily automatic run can be switched off with DUE_AUTO_REMINDERS=off. */
const autoRemindersOn = () => process.env.DUE_AUTO_REMINDERS !== 'off';

const taka = (amount: number) => `৳${Math.round(amount).toLocaleString('en-IN')}`;

export function defaultDueMessage(due: number): string {
  return (
    `আপনার প্ল্যাটফর্ম বকেয়া (Due) ${taka(due)}। ক্যাশে নেওয়া কাজের কমিশন বাবদ এই টাকা প্ল্যাটফর্মের পাওনা। ` +
    'অ্যাপের উপরে "Pay Now" চেপে বিকাশ, নগদ বা কার্ডে পরিশোধ করুন। বকেয়া পরিশোধ না হওয়া পর্যন্ত নতুন অর্ডার নিতে পারবেন না।'
  );
}

/** Staff may write their own words; the amount is always added so the provider sees exactly what they owe. */
export function customDueMessage(text: string, due: number): string {
  return `${text.trim()}\n\nআপনার বকেয়া: ${taka(due)}`;
}

/**
 * Due list and reminders. A provider with a negative wallet owes the platform the commission of their cash jobs.
 * A reminder goes two ways: a message in their Support chat (it stays, with an unread badge) and a live
 * `dueReminder` event to any app they have open. Staff send them from the Dues tab; a daily run reminds anyone
 * still owing who has not been reminded for reminderIntervalDays(). Every reminder is logged (DueReminder).
 * There is no SMS gateway yet; when one exists it belongs in send().
 */
@Injectable()
export class DueReminderService {
  private readonly logger = new Logger(DueReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(USER_EVENT_PUBLISHER) private readonly events: UserEventPublisher,
  ) {}

  /** Every provider who owes, the largest due first, with when they were last reminded. */
  async listDues() {
    const providers = await this.prisma.providerProfile.findMany({
      where: { walletBalance: { lt: 0 } },
      orderBy: { walletBalance: 'asc' },
      select: {
        id: true,
        companyName: true,
        walletBalance: true,
        isBlockedForNegative: true,
        commissionRate: true,
        user: { select: { id: true, name: true, username: true, mobileNumber: true, profilePhoto: true, status: true } },
        dueReminders: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, isAutomatic: true } },
        _count: { select: { dueReminders: true } },
      },
    });

    const globalRate = await readPlatformOrderCommission(this.prisma);
    const rows = providers.map((provider) => ({
      providerId: provider.id,
      userId: provider.user.id,
      name: provider.companyName || provider.user.name || provider.user.username || provider.user.mobileNumber,
      mobileNumber: provider.user.mobileNumber,
      profilePhoto: provider.user.profilePhoto,
      accountStatus: provider.user.status,
      dueAmount: -Number(provider.walletBalance),
      isBlocked: provider.isBlockedForNegative,
      commissionRate: effectiveCommissionRate(provider.commissionRate, globalRate),
      lastReminderAt: provider.dueReminders[0]?.createdAt ?? null,
      lastReminderWasAutomatic: provider.dueReminders[0]?.isAutomatic ?? null,
      reminderCount: provider._count.dueReminders,
    }));
    return {
      totalDue: rows.reduce((sum, row) => sum + row.dueAmount, 0),
      count: rows.length,
      reminderIntervalDays: reminderIntervalDays(),
      isAutoReminderOn: autoRemindersOn(),
      providers: rows,
    };
  }

  /** One provider's reminder history, newest first. */
  history(providerId: string) {
    return this.prisma.dueReminder.findMany({ where: { providerId }, orderBy: { createdAt: 'desc' }, take: 30 });
  }

  /**
   * Staff remind the chosen providers, or everyone who owes when none are chosen. Providers who no longer owe
   * are skipped. Returns how many were reminded.
   */
  async remind(actorId: string | null, options: { providerIds?: string[]; message?: string } = {}) {
    const providers = await this.prisma.providerProfile.findMany({
      where: { walletBalance: { lt: 0 }, ...(options.providerIds?.length ? { id: { in: options.providerIds } } : {}) },
      select: { id: true, walletBalance: true, userId: true },
    });
    const senderId = actorId ?? (await this.systemSenderId());

    let sent = 0;
    for (const provider of providers) {
      const due = -Number(provider.walletBalance);
      const message = options.message?.trim() ? customDueMessage(options.message, due) : defaultDueMessage(due);
      try {
        await this.send({ providerId: provider.id, userId: provider.userId, due, message, senderId, sentById: actorId });
        sent += 1;
      } catch (error) {
        this.logger.warn(`Could not remind provider ${provider.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { sent, skipped: (options.providerIds?.length ?? providers.length) - sent };
  }

  /** The daily run (DueReminderScheduler, 10 AM): everyone still owing who was not reminded within the interval. */
  async remindDueAutomatically(now = new Date()) {
    if (!autoRemindersOn()) return { sent: 0, skipped: 0 };
    const since = new Date(now.getTime() - reminderIntervalDays() * 24 * 60 * 60 * 1000);
    const due = await this.prisma.providerProfile.findMany({
      where: { walletBalance: { lt: 0 }, dueReminders: { none: { createdAt: { gt: since } } } },
      select: { id: true },
    });
    if (due.length === 0) return { sent: 0, skipped: 0 };
    const result = await this.remind(null, { providerIds: due.map((provider) => provider.id) });
    this.logger.log(`Automatic due reminders: ${result.sent} sent`);
    return result;
  }

  private async send(input: { providerId: string; userId: string; due: number; message: string; senderId: string | null; sentById: string | null }) {
    await this.prisma.$transaction(async (tx) => {
      // The Support chat keeps it: the provider sees it there (unread) even if they were offline.
      if (input.senderId) {
        const thread = await tx.supportThread.upsert({ where: { memberId: input.userId }, update: { updatedAt: new Date() }, create: { memberId: input.userId }, select: { id: true } });
        await tx.supportMessage.create({ data: { threadId: thread.id, senderId: input.senderId, text: input.message } });
      }
      await tx.dueReminder.create({
        data: { providerId: input.providerId, amount: input.due, message: input.message, sentById: input.sentById, isAutomatic: input.sentById === null },
      });
    });
    // Live, if their app is open: the app shows it with a Pay Now.
    this.events.publishToUser(input.userId, 'dueReminder', { dueAmount: input.due, message: input.message });
  }

  /** Automatic reminders are written in Support as the first admin (providers only ever see "Support"). */
  private async systemSenderId(): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({ where: { role: UserRole.ADMIN }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    return admin?.id ?? null;
  }
}

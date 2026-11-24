import { DueReminderService, customDueMessage, defaultDueMessage } from './due-reminder.service';

const NOW = new Date('2026-11-24T10:00:00.000Z');

function build(owing: Array<{ id: string; walletBalance: number; userId: string }> = [{ id: 'p1', walletBalance: -1300, userId: 'u1' }]) {
  const tx = {
    supportThread: { upsert: jest.fn().mockResolvedValue({ id: 't1' }) },
    supportMessage: { create: jest.fn() },
    dueReminder: { create: jest.fn() },
  };
  const prisma = {
    providerProfile: { findMany: jest.fn().mockResolvedValue(owing) },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'first-admin' }) },
    dueReminder: { findMany: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const events = { publishToUser: jest.fn() };
  return { service: new DueReminderService(prisma as never, events), prisma, tx, events };
}

describe('due reminder messages', () => {
  it('names the due and how to pay it', () => {
    const text = defaultDueMessage(1300);
    expect(text).toContain('৳1,300');
    expect(text).toContain('Pay Now');
  });

  it("adds the due after staff's own words", () => {
    expect(customDueMessage('  দয়া করে আজকের মধ্যে দিন। ', 1300)).toBe('দয়া করে আজকের মধ্যে দিন।\n\nআপনার বকেয়া: ৳1,300');
  });
});

describe('DueReminderService', () => {
  it('writes into the Support chat, logs it and alerts the open app', async () => {
    const { service, tx, events } = build();
    await expect(service.remind('staff-1')).resolves.toEqual({ sent: 1, skipped: 0 });
    expect(tx.supportThread.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: 'u1' } }));
    expect(tx.supportMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ threadId: 't1', senderId: 'staff-1', text: defaultDueMessage(1300) }) });
    expect(tx.dueReminder.create).toHaveBeenCalledWith({ data: expect.objectContaining({ providerId: 'p1', amount: 1300, sentById: 'staff-1', isAutomatic: false }) });
    expect(events.publishToUser).toHaveBeenCalledWith('u1', 'dueReminder', expect.objectContaining({ dueAmount: 1300 }));
  });

  it('reminds only chosen providers who still owe, and counts the rest as skipped', async () => {
    const { service, prisma } = build();
    await expect(service.remind('staff-1', { providerIds: ['p1', 'p2'] })).resolves.toEqual({ sent: 1, skipped: 1 });
    expect(prisma.providerProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { walletBalance: { lt: 0 }, id: { in: ['p1', 'p2'] } } }));
  });

  it('runs daily for everyone owing who was not reminded in the last 3 days, as Support', async () => {
    const { service, prisma, tx } = build();
    await service.remindDueAutomatically(NOW);
    const since = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
    expect(prisma.providerProfile.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { walletBalance: { lt: 0 }, dueReminders: { none: { createdAt: { gt: since } } } } }));
    expect(tx.supportMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ senderId: 'first-admin' }) });
    expect(tx.dueReminder.create).toHaveBeenCalledWith({ data: expect.objectContaining({ sentById: null, isAutomatic: true }) });
  });

  it('can be switched off', async () => {
    process.env.DUE_AUTO_REMINDERS = 'off';
    const { service, prisma } = build();
    await expect(service.remindDueAutomatically(NOW)).resolves.toEqual({ sent: 0, skipped: 0 });
    expect(prisma.providerProfile.findMany).not.toHaveBeenCalled();
    delete process.env.DUE_AUTO_REMINDERS;
  });
});

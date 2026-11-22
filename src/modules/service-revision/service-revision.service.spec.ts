import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ServiceRevisionService } from './service-revision.service';
import { REVISION_WINDOW_DAYS, revisionDeadline } from './revision-window';

const NOW = new Date('2026-11-22T10:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

function build(order: Partial<{ orderStatus: string; completedAt: Date | null; revisions: Array<{ revisionStatus: string }> }> = {}, reopenedCount = 1) {
  const found = { id: 'o1', orderStatus: 'COMPLETED', completedAt: daysAgo(2), customer: { userId: 'u-customer' }, revisions: [], ...order };
  const tx = {
    order: { updateMany: jest.fn().mockResolvedValue({ count: reopenedCount }) },
    serviceRevision: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'r1', ...data })) },
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(found) },
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { service: new ServiceRevisionService(prisma as never), tx };
}

const request = { orderId: 'o1', issueDescription: '  AC is leaking again  ' };
const customer = { id: 'u-customer', role: 'CUSTOMER' };

describe('ServiceRevisionService.create (7-day warranty)', () => {
  beforeEach(() => { jest.useFakeTimers().setSystemTime(NOW); });
  afterEach(() => jest.useRealTimers());

  it('lets the customer send a completed order back within 7 days, reopening it for the provider', async () => {
    const { service, tx } = build();
    const revision = await service.create(request, customer);
    expect(tx.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o1', orderStatus: 'COMPLETED' }, data: { orderStatus: 'IN_PROGRESS' } });
    expect(revision).toMatchObject({ issueDescription: 'AC is leaking again', revisionStatus: 'REQUESTED', warrantyExpiresAt: revisionDeadline({ completedAt: daysAgo(2) }) });
  });

  it('lets an admin request it too', async () => {
    const { service } = build();
    await expect(service.create(request, { id: 'u-admin', role: 'ADMIN' })).resolves.toBeDefined();
  });

  it('turns away the provider, other staff and other customers', async () => {
    for (const actor of [{ id: 'u-provider', role: 'PROVIDER' }, { id: 'u-manager', role: 'MANAGER' }, { id: 'u-other', role: 'CUSTOMER' }]) {
      const { service } = build();
      await expect(service.create(request, actor)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it(`refuses once the ${REVISION_WINDOW_DAYS}-day warranty has ended`, async () => {
    const { service } = build({ completedAt: daysAgo(REVISION_WINDOW_DAYS + 0.01) });
    await expect(service.create(request, customer)).rejects.toThrow('7-day service warranty');
  });

  it('refuses an order that is not completed, or was never completed', async () => {
    await expect(build({ orderStatus: 'IN_PROGRESS' }).service.create(request, customer)).rejects.toBeInstanceOf(BadRequestException);
    await expect(build({ completedAt: null }).service.create(request, customer)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('opens only one revision at a time', async () => {
    await expect(build({ revisions: [{ revisionStatus: 'REQUESTED' }] }).service.create(request, customer)).rejects.toBeInstanceOf(ConflictException);
    // Two taps at once: the second finds the order already reopened.
    await expect(build({}, 0).service.create(request, customer)).rejects.toBeInstanceOf(ConflictException);
  });
});

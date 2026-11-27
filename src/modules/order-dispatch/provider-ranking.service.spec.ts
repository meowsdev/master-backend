import { ProviderRankingService } from './provider-ranking.service';
import { DEFAULT_WEIGHTS } from './ranking-rules';

function build(row: Record<string, unknown> | null = null) {
  const prisma = {
    dispatchSetting: {
      findUnique: jest.fn().mockResolvedValue(row),
      upsert: jest.fn().mockResolvedValue({}),
    },
    providerProfile: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'p1', rating: 4, level: 'LEVEL_1', walletBalance: -100 },
        { id: 'p2', rating: 0, level: 'LEVEL_0', walletBalance: 0 },
      ]),
    },
    orderOffer: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { createdAt: new Date(0), respondedAt: new Date(30_000) },
        ]),
    },
    dueReminder: { count: jest.fn().mockResolvedValue(1) },
    order: { count: jest.fn().mockResolvedValue(2) },
    providerReview: { count: jest.fn().mockResolvedValue(3) },
    providerDispatchStats: {
      upsert: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const leveling = {
    metricsFor: jest.fn().mockResolvedValue({
      successScore: 8,
      rating: 4.5,
      responseRate: 90,
      orders: 12,
      uniqueClients: 5,
      earnings: 0,
    }),
  };
  return {
    service: new ProviderRankingService(prisma as never, leveling),
    prisma,
    leveling,
  };
}

describe('dispatch settings', () => {
  it('is off with the balanced weights before an admin saves anything', async () => {
    await expect(build().service.getSettings()).resolves.toEqual({
      isEnabled: false,
      weights: DEFAULT_WEIGHTS,
    });
  });

  it('keeps every weight within 0-10', async () => {
    const { service, prisma } = build();
    await service.updateSettings(
      {
        isEnabled: false,
        weights: { ...DEFAULT_WEIGHTS, responseRate: 40, workload: -3 },
      },
      'admin',
    );
    const [[upsert]] = prisma.dispatchSetting.upsert.mock.calls as [
      [{ update: unknown }],
    ];
    expect(upsert.update).toEqual(
      expect.objectContaining({
        responseRate: 10,
        workload: 0,
        updatedById: 'admin',
      }),
    );
  });

  it('works out the numbers first when ranking is turned on, so nobody is ranked blind', async () => {
    const { service, prisma } = build();
    await service.updateSettings(
      { isEnabled: true, weights: DEFAULT_WEIGHTS },
      'admin',
    );
    expect(prisma.providerDispatchStats.upsert).toHaveBeenCalledTimes(2);
  });
});

describe("refreshing providers' numbers", () => {
  it('stores response, speed, quality, behaviour and workload for each provider', async () => {
    const { service, prisma } = build();
    await service.refreshAllStats();
    const [[upsert]] = prisma.providerDispatchStats.upsert.mock.calls as [
      [{ create: unknown }],
    ];
    expect(upsert.create).toEqual(
      expect.objectContaining({
        providerId: 'p1',
        responseRate: 90,
        avgResponseSeconds: 30,
        successScore: 8,
        rating: 4.5,
        behaviour: 60,
        completedOrders: 12,
        activeOrders: 2,
      }),
    );
  });

  it('carries on with the others when one provider fails', async () => {
    const { service, leveling } = build();
    leveling.metricsFor.mockRejectedValueOnce(new Error('boom'));
    await expect(service.refreshAllStats()).resolves.toEqual({
      refreshed: 1,
      failed: 1,
    });
  });

  it('skips the work while ranking is off', async () => {
    const { service, prisma } = build({ isEnabled: false, ...DEFAULT_WEIGHTS });
    await service.handleRefreshCron();
    expect(prisma.providerProfile.findMany).not.toHaveBeenCalled();
  });
});

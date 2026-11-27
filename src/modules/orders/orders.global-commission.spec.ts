import {
  DEFAULT_PLATFORM_ORDER_COMMISSION,
  effectiveCommissionRate,
  providerCommissionPercent,
  readPlatformOrderCommission,
} from './orders.helpers';

function client(
  provider: { commissionRate: number | null } | null,
  globalRate: number | null,
) {
  return {
    providerProfile: { findUnique: jest.fn().mockResolvedValue(provider) },
    platformSetting: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          globalRate === null
            ? null
            : { platformOrderCommissionRate: globalRate },
        ),
    },
  };
}

describe('commission on orders from the platform', () => {
  it("keeps a provider's own rate (every provider from before the global rate kept theirs, e.g. 10%)", async () => {
    await expect(
      providerCommissionPercent(
        client({ commissionRate: 10 }, 50) as never,
        'p1',
      ),
    ).resolves.toBe(10);
  });

  it('gives a provider without their own rate (a new provider) the global rate', async () => {
    await expect(
      providerCommissionPercent(
        client({ commissionRate: null }, 40) as never,
        'p1',
      ),
    ).resolves.toBe(40);
  });

  it('starts the global rate at 50% until an admin changes it', async () => {
    await expect(
      readPlatformOrderCommission(client(null, null) as never),
    ).resolves.toBe(DEFAULT_PLATFORM_ORDER_COMMISSION);
    expect(DEFAULT_PLATFORM_ORDER_COMMISSION).toBe(50);
  });

  it('shows the global rate for a provider without their own, never 0 by accident', () => {
    expect(effectiveCommissionRate(null, 50)).toBe(50);
    expect(effectiveCommissionRate(0, 50)).toBe(0);
    expect(effectiveCommissionRate(12.5, 50)).toBe(12.5);
  });
});

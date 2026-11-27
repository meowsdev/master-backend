import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_COMMISSION_PERCENT,
  readPlatformOrderCommission,
} from '../orders/orders.helpers';

const SETTINGS_ID = 'default';

export interface ProviderOrderChargeSetting {
  enabled: boolean;
  /** Percent (10 = 10%). */
  rate: number;
}

type SettingsReader = {
  platformSetting: {
    findUnique: Prisma.TransactionClient['platformSetting']['findUnique'];
  };
};

/**
 * The platform's charge on an order a provider creates for their own customer: the admin's one rule for every
 * provider. With no settings row yet it is on at the default percent (10%).
 */
export async function readProviderOrderCharge(
  client: SettingsReader,
): Promise<ProviderOrderChargeSetting> {
  const row = await client.platformSetting.findUnique({
    where: { id: SETTINGS_ID },
  });
  return row
    ? {
        enabled: row.providerOrderChargeEnabled,
        rate: Number(row.providerOrderChargeRate),
      }
    : { enabled: true, rate: DEFAULT_COMMISSION_PERCENT };
}

/** The percent a provider-created order is charged at: 0 while the charge is off. */
export function providerOrderChargePercent(
  setting: ProviderOrderChargeSetting,
): number {
  return setting.enabled ? setting.rate : 0;
}

/**
 * The charge on an order this provider creates for their own customer: their own percent if an admin set one on
 * their details, else the admin's one rule for every provider (0 while it is off).
 */
export async function ownOrderChargePercentFor(
  client: SettingsReader & {
    providerProfile: {
      findUnique: Prisma.TransactionClient['providerProfile']['findUnique'];
    };
  },
  providerId: string,
): Promise<number> {
  const provider = await client.providerProfile.findUnique({
    where: { id: providerId },
    select: { ownOrderChargeRate: true },
  });
  if (
    provider?.ownOrderChargeRate !== null &&
    provider?.ownOrderChargeRate !== undefined
  )
    return Number(provider.ownOrderChargeRate);
  return providerOrderChargePercent(await readProviderOrderCharge(client));
}

@Injectable()
export class PlatformSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  getProviderOrderCharge() {
    return readProviderOrderCharge(this.prisma);
  }

  /** Applies to orders created from now on; a running order keeps the percent it was created with. */
  async setProviderOrderCharge(
    setting: ProviderOrderChargeSetting,
    adminId: string,
  ): Promise<ProviderOrderChargeSetting> {
    const data = {
      providerOrderChargeEnabled: setting.enabled,
      providerOrderChargeRate: setting.rate,
      updatedById: adminId,
    };
    const row = await this.prisma.platformSetting.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    return {
      enabled: row.providerOrderChargeEnabled,
      rate: Number(row.providerOrderChargeRate),
    };
  }

  getPlatformOrderCommission() {
    return readPlatformOrderCommission(this.prisma).then((rate) => ({ rate }));
  }

  /**
   * The global commission on orders from the platform, for every provider without their own rate (new providers).
   * Providers with their own rate keep it; new orders only, running orders keep their percent.
   */
  async setPlatformOrderCommission(rate: number, adminId: string) {
    const data = { platformOrderCommissionRate: rate, updatedById: adminId };
    const row = await this.prisma.platformSetting.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, ...data },
      update: data,
    });
    return { rate: Number(row.platformOrderCommissionRate) };
  }
}

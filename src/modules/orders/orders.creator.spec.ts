import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/** A provider (p1, positive wallet) on 15%, and the admin's provider-order rule from `setting` (null = no row). */
function build(
  setting: {
    providerOrderChargeEnabled: boolean;
    providerOrderChargeRate: number;
  } | null,
  walletBalance = 100,
) {
  const prisma = {
    service: {
      findUnique: jest.fn().mockResolvedValue({
        id: 's1',
        categoryId: 'cat1',
        isActive: true,
        isDeleted: false,
      }),
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 's1', isActive: true, isDeleted: false }),
    },
    customerProfile: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        userId: 'u-c',
        user: { isRestricted: false },
      }),
    },
    providerProfile: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'p1', walletBalance, commissionRate: 15 }),
    },
    platformSetting: { findUnique: jest.fn().mockResolvedValue(setting) },
    order: {
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'o1', ...data }),
        ),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const dispatch = {
    findEligibleProviderIds: jest.fn().mockResolvedValue(['p2']),
    dispatchNextWave: jest.fn().mockResolvedValue(1),
  };
  return {
    service: new OrdersService(prisma as never, dispatch as never),
    prisma,
    dispatch,
  };
}

const providerOrigin = {
  createdByRole: 'PROVIDER',
  createdById: 'u-p',
  ownProviderId: 'p1',
} as never;
const order = {
  serviceId: 's1',
  customerId: 'c1',
  originalPrice: 1000,
} as never;
type CreatedData = Record<string, unknown> & {
  acceptedAt?: Date;
  orderStatus?: string;
};
const created = (prisma: ReturnType<typeof build>['prisma']): CreatedData =>
  (prisma.order.create.mock.calls[0] as [{ data: CreatedData }])[0].data;

describe("a provider's own order", () => {
  it('goes to that provider at once, in progress like an accepted order, never offered to anyone else', async () => {
    const { service, prisma, dispatch } = build(null);
    await service.create(
      order,
      { id: 'u-c', role: 'CUSTOMER' as never },
      undefined,
      { origin: providerOrigin },
    );
    expect(dispatch.findEligibleProviderIds).not.toHaveBeenCalled();
    expect(dispatch.dispatchNextWave).not.toHaveBeenCalled();
    expect(created(prisma)).toEqual(
      expect.objectContaining({
        providerId: 'p1',
        orderStatus: 'IN_PROGRESS',
        createdByRole: 'PROVIDER',
        createdById: 'u-p',
      }),
    );
    expect(created(prisma).acceptedAt).toBeInstanceOf(Date);
  });

  it("is charged 10% by default, not the provider's own rate", async () => {
    const { service, prisma } = build(null);
    await service.create(order, undefined, undefined, {
      origin: providerOrigin,
    });
    expect(created(prisma)).toEqual(
      expect.objectContaining({ commissionRate: 10, adminCommission: 100 }),
    );
  });

  it("uses the admin's percent", async () => {
    const { service, prisma } = build({
      providerOrderChargeEnabled: true,
      providerOrderChargeRate: 5,
    });
    await service.create(order, undefined, undefined, {
      origin: providerOrigin,
    });
    expect(created(prisma)).toEqual(
      expect.objectContaining({ commissionRate: 5, adminCommission: 50 }),
    );
  });

  it('is free while the admin has the charge turned off', async () => {
    const { service, prisma } = build({
      providerOrderChargeEnabled: false,
      providerOrderChargeRate: 10,
    });
    await service.create(order, undefined, undefined, {
      origin: providerOrigin,
    });
    expect(created(prisma)).toEqual(
      expect.objectContaining({ commissionRate: 0, adminCommission: 0 }),
    );
  });

  it("uses this provider's own percent when the admin set one, even while the global charge is off", async () => {
    const { service, prisma } = build({
      providerOrderChargeEnabled: false,
      providerOrderChargeRate: 10,
    });
    prisma.providerProfile.findUnique.mockResolvedValue({
      id: 'p1',
      walletBalance: 100,
      commissionRate: 15,
      ownOrderChargeRate: 3,
    });
    await service.create(order, undefined, undefined, {
      origin: providerOrigin,
    });
    expect(created(prisma)).toEqual(
      expect.objectContaining({ commissionRate: 3, adminCommission: 30 }),
    );
  });

  it('keeps the platform order percent (15%) for orders that come from the platform', async () => {
    const { service, prisma } = build(null);
    prisma.providerProfile.findUnique.mockResolvedValue({
      id: 'p1',
      walletBalance: 100,
      commissionRate: 15,
      ownOrderChargeRate: 3,
    });
    await service.create(order, { id: 'u-c', role: 'CUSTOMER' as never });
    expect(created(prisma)).toEqual(
      expect.objectContaining({ commissionRate: 15, adminCommission: 150 }),
    );
  });

  it('is refused while the provider owes a due', async () => {
    const { service, prisma } = build(null, -200);
    await expect(
      service.create(order, undefined, undefined, { origin: providerOrigin }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
});

describe('the created-by tag on other orders', () => {
  it("marks an order from the app as the customer's, on their own commission and dispatched as before", async () => {
    const { service, prisma, dispatch } = build(null);
    await service.create(order, { id: 'u-c', role: 'CUSTOMER' as never });
    expect(created(prisma)).toEqual(
      expect.objectContaining({
        createdByRole: 'CUSTOMER',
        createdById: 'u-c',
        commissionRate: 15,
      }),
    );
    expect(created(prisma).orderStatus).toBeUndefined();
    expect(dispatch.dispatchNextWave).toHaveBeenCalled();
  });

  it("marks a staff booking as the admin's", async () => {
    const { service, prisma } = build(null);
    await service.create(
      order,
      { id: 'u-c', role: 'CUSTOMER' as never },
      undefined,
      { origin: { createdByRole: 'ADMIN', createdById: 'u-a' } as never },
    );
    expect(created(prisma)).toEqual(
      expect.objectContaining({
        createdByRole: 'ADMIN',
        createdById: 'u-a',
        commissionRate: 15,
      }),
    );
  });
});

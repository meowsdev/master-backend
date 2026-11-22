import { ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';

function build(options: { providerProfileId?: string | null; customerProfileId?: string | null } = {}) {
  const prisma = {
    providerProfile: { findUnique: jest.fn().mockResolvedValue(options.providerProfileId ? { id: options.providerProfileId } : null) },
    customerProfile: { findUnique: jest.fn().mockResolvedValue(options.customerProfileId ? { id: options.customerProfileId } : null) },
    order: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { service: new OrdersService(prisma as never, {} as never), prisma };
}

describe('who may list a provider\'s or a customer\'s orders', () => {
  it('lets a provider read only their own orders', async () => {
    const { service, prisma } = build({ providerProfileId: 'pp1' });
    await service.findByProviderForUser('pp1', { id: 'u', role: 'PROVIDER' as never });
    expect(prisma.order.findMany).toHaveBeenCalled();
    await expect(service.findByProviderForUser('pp-other', { id: 'u', role: 'PROVIDER' as never })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('turns away a technician and a customer from a provider\'s orders', async () => {
    for (const role of ['TECHNICIAN', 'CUSTOMER']) {
      const { service, prisma } = build({ providerProfileId: 'pp1' });
      await expect(service.findByProviderForUser('pp1', { id: 'u', role: role as never })).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    }
  });

  it('lets a customer read only their own orders and turns a technician away', async () => {
    const { service } = build({ customerProfileId: 'cp1' });
    await expect(service.findByCustomerForUser('cp1', { id: 'u', role: 'CUSTOMER' as never })).resolves.toEqual([]);
    await expect(service.findByCustomerForUser('cp-other', { id: 'u', role: 'CUSTOMER' as never })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findByCustomerForUser('cp1', { id: 'u', role: 'TECHNICIAN' as never })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets platform staff read anyone\'s orders', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'SUPPORT', 'HR', 'COUNSELOR']) {
      const { service } = build();
      await expect(service.findByProviderForUser('anyone', { id: 's', role: role as never })).resolves.toEqual([]);
      await expect(service.findByCustomerForUser('anyone', { id: 's', role: role as never })).resolves.toEqual([]);
    }
  });
});

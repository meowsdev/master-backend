import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { OrdersService } from './orders.service';

/** Prisma is never reached: the role check must run (and fail) first. */
const service = new OrdersService({} as never, {} as never);
const technicianId = 'c1b5f10e-656a-4d4f-8f63-7c5d60fb3d5d';

describe('assigning a technician to an order is ADMIN only', () => {
  const nonAdmins = [UserRole.CUSTOMER, UserRole.PROVIDER, UserRole.COUNSELOR, UserRole.TECHNICIAN, UserRole.MANAGER, UserRole.SUPPORT];

  it.each(nonAdmins)('%s cannot set technicianId when updating an order', async (role) => {
    await expect(
      service.update('order-1', { technicianId } as never, { id: 'u1', role }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each(nonAdmins)('%s cannot pick a technician when creating an order', async (role) => {
    await expect(
      service.create({ technicianId, serviceId: 's1' } as never, { id: 'u1', role }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a request without any user cannot pick a technician either', async () => {
    await expect(service.create({ technicianId, serviceId: 's1' } as never)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

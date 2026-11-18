import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderTechnicianService } from './order-technician.service';

const order = { id: 'o1', providerId: 'pp1', technicianId: null, orderStatus: 'ACCEPTED', provider: { userId: 'provider-user' } };
const ownTechnician = { id: 't1', providerAgencyId: 'pp1', user: { status: 'ACTIVE' } };

function build(options: { order?: Partial<typeof order> | null; technician?: unknown } = {}) {
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(options.order === null ? null : { ...order, ...options.order }), update: jest.fn() },
    technicianProfile: {
      findUnique: jest.fn().mockResolvedValue(options.technician === undefined ? ownTechnician : options.technician),
      findMany: jest.fn().mockResolvedValue([{ id: 't1', user: { name: 'Karim', username: null, profilePhoto: null, status: 'ACTIVE' }, _count: { orders: 2 } }]),
    },
  };
  return { service: new OrderTechnicianService(prisma as never), prisma };
}

const owner = { id: 'provider-user', role: 'PROVIDER' as never };
const otherProvider = { id: 'someone-else', role: 'PROVIDER' as never };
const admin = { id: 'admin-1', role: 'ADMIN' as never };

describe('OrderTechnicianService.setTechnician', () => {
  it('lets the provider of the order put their own technician on it', async () => {
    const { service, prisma } = build();
    await service.setTechnician(owner, 'o1', 't1');
    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { technicianId: 't1' } });
  });

  it('lets an admin do the same, and take the technician off with null', async () => {
    const { service, prisma } = build({ order: { technicianId: 't1' } as never });
    await service.setTechnician(admin, 'o1', null);
    expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { technicianId: null } });
  });

  it('turns away another provider, a customer and a technician', async () => {
    for (const actor of [otherProvider, { id: 'c', role: 'CUSTOMER' as never }, { id: 't', role: 'TECHNICIAN' as never }]) {
      const { service, prisma } = build();
      await expect(service.setTechnician(actor, 'o1', 't1')).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    }
  });

  it('never puts a technician of another provider on the order', async () => {
    const { service, prisma } = build({ technician: { ...ownTechnician, providerAgencyId: 'pp-other' } });
    await expect(service.setTechnician(owner, 'o1', 't1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('refuses a blocked technician', async () => {
    const { service } = build({ technician: { ...ownTechnician, user: { status: 'SUSPENDED' } } });
    await expect(service.setTechnician(owner, 'o1', 't1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only works while the order is accepted or in progress', async () => {
    for (const orderStatus of ['PENDING', 'COMPLETED', 'CANCELLED']) {
      const { service, prisma } = build({ order: { orderStatus } });
      await expect(service.setTechnician(owner, 'o1', 't1')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    }
  });

  it('answers 404 for a missing order or technician', async () => {
    await expect(build({ order: null }).service.setTechnician(owner, 'o1', 't1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(build({ technician: null }).service.setTechnician(owner, 'o1', 't1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrderTechnicianService.listForOrder', () => {
  it('lists only the technicians of the order\'s own provider, with their running jobs', async () => {
    const { service, prisma } = build({ order: { technicianId: 't1' } as never });
    const result = await service.listForOrder(owner, 'o1');
    expect(prisma.technicianProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { providerAgencyId: 'pp1' } }));
    expect(result).toMatchObject({ currentTechnicianId: 't1', technicians: [{ id: 't1', name: 'Karim', activeJobs: 2, isActive: true }] });
  });

  it('is closed to a provider who does not own the order', async () => {
    await expect(build().service.listForOrder(otherProvider, 'o1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

import { ConflictException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TechnicianProfileService } from './technician-profile.service';

function build(existingUser: unknown, agencyExists = true) {
  const createdUser = { id: 'new-user' };
  const tx = {
    user: { create: jest.fn().mockResolvedValue(createdUser) },
    technicianProfile: { create: jest.fn().mockResolvedValue({ id: 'profile-1' }) },
  };
  const prisma = {
    providerProfile: { findUnique: jest.fn().mockResolvedValue(agencyExists ? { id: 'agency-1', user: { role: UserRole.PROVIDER } } : null) },
    user: { findUnique: jest.fn().mockResolvedValue(existingUser) },
    $transaction: jest.fn((run) => run(tx)),
  };
  return { service: new TechnicianProfileService(prisma as never), tx };
}

describe('TechnicianProfileService.createByAdmin', () => {
  const dto = { mobileNumber: '+8801700000000', name: 'Rahim', providerAgencyId: 'agency-1' };

  it('creates a TECHNICIAN user and profile for a new number', async () => {
    const { service, tx } = build(null);
    await service.createByAdmin(dto);
    expect(tx.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ role: UserRole.TECHNICIAN, status: 'ACTIVE', isVerified: true }),
    });
    expect(tx.technicianProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'new-user', providerAgencyId: 'agency-1' }) }),
    );
  });

  it('refuses a number that already belongs to another role (one role per number)', async () => {
    const { service, tx } = build({ id: 'u1', role: UserRole.CUSTOMER, technicianProfile: null });
    await expect(service.createByAdmin(dto)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('refuses a number that is already a technician', async () => {
    const { service } = build({ id: 'u1', role: UserRole.TECHNICIAN, technicianProfile: { id: 'p' } });
    await expect(service.createByAdmin(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses an unknown provider agency', async () => {
    const { service } = build(null, false);
    await expect(service.createByAdmin(dto)).rejects.toThrow(/Provider agency not found/);
  });
});

describe('TechnicianProfileService.assignAgency', () => {
  function buildAssign(options: { currentAgency: string | null; activeJobs: number }) {
    const prisma = {
      technicianProfile: {
        findUnique: jest.fn().mockResolvedValue({ id: 't1', providerAgencyId: options.currentAgency }),
        update: jest.fn().mockResolvedValue({ id: 't1' }),
      },
      providerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'agency-2', user: { role: UserRole.PROVIDER } }) },
      order: { count: jest.fn().mockResolvedValue(options.activeJobs) },
    };
    return { service: new TechnicianProfileService(prisma as never), prisma };
  }

  it('moves a technician who has no job running', async () => {
    const { service, prisma } = buildAssign({ currentAgency: 'agency-1', activeJobs: 0 });
    await service.assignAgency('t1', 'agency-2');
    expect(prisma.technicianProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { providerAgencyId: 'agency-2' } }));
  });

  it('refuses to move a technician in the middle of a job', async () => {
    const { service, prisma } = buildAssign({ currentAgency: 'agency-1', activeJobs: 2 });
    await expect(service.assignAgency('t1', 'agency-2')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.technicianProfile.update).not.toHaveBeenCalled();
  });

  it('does not count jobs when the provider stays the same', async () => {
    const { service, prisma } = buildAssign({ currentAgency: 'agency-2', activeJobs: 5 });
    await service.assignAgency('t1', 'agency-2');
    expect(prisma.order.count).not.toHaveBeenCalled();
  });
});

describe('TechnicianProfileService provider check', () => {
  it('only puts a technician under a real provider, not a stray profile of another role', async () => {
    const prisma = {
      technicianProfile: { findUnique: jest.fn().mockResolvedValue({ id: 't1', providerAgencyId: null }), update: jest.fn() },
      providerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'agency-9', user: { role: UserRole.CUSTOMER } }) },
      order: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new TechnicianProfileService(prisma as never);
    await expect(service.assignAgency('t1', 'agency-9')).rejects.toThrow('Provider agency not found');
    expect(prisma.technicianProfile.update).not.toHaveBeenCalled();
  });
});

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
    providerProfile: { findUnique: jest.fn().mockResolvedValue(agencyExists ? { id: 'agency-1' } : null) },
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

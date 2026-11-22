import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminStaffService } from './admin-staff.service';

function build(options: { existing?: { role: string } | null; target?: { id: string; role: string; status: string } | null } = {}) {
  const tx = {
    user: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'staff', ...data })),
    },
    counselorProfile: { create: jest.fn(), upsert: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
  };
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(options.existing ?? null),
      findUnique: jest.fn().mockResolvedValue(options.target === undefined ? { id: 'staff', role: 'SUPPORT', status: 'ACTIVE' } : options.target),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { service: new AdminStaffService(prisma as never), tx, prisma };
}

const ADMIN = { id: 'admin' };

describe('adding staff', () => {
  it('creates an active staff account in the chosen position', async () => {
    const { service, tx } = build();
    const user = await service.create({ mobileNumber: '+8801712345678', name: '  Rahim  ', role: 'SUPPORT' });
    expect(user).toMatchObject({ mobileNumber: '+8801712345678', name: 'Rahim', role: 'SUPPORT', status: 'ACTIVE' });
    expect(tx.counselorProfile.create).not.toHaveBeenCalled();
  });

  it('gives a counselor the profile row their chats need', async () => {
    const { service, tx } = build();
    await service.create({ mobileNumber: '+8801712345678', name: 'Karim', role: 'COUNSELOR' });
    expect(tx.counselorProfile.create).toHaveBeenCalledWith({ data: { userId: 'new' } });
  });

  it('refuses a number that already belongs to anyone (one number, one role), however it is written', async () => {
    const { service, prisma } = build({ existing: { role: 'CUSTOMER' } });
    await expect(service.create({ mobileNumber: '+8801712345678', name: 'X', role: 'HR' })).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { mobileNumber: { in: ['+8801712345678', '8801712345678', '01712345678'] } } }));
  });
});

describe('changing staff', () => {
  it('changes the position and signs them out so the new screen applies at once', async () => {
    const { service, tx } = build();
    await service.update('staff', { role: 'MANAGER' }, ADMIN);
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'MANAGER' } }));
    expect(tx.refreshToken.updateMany).toHaveBeenCalled();
  });

  it('turns an account off (signed out) and back on', async () => {
    const { service, tx } = build();
    await service.update('staff', { status: 'SUSPENDED' }, ADMIN);
    expect(tx.refreshToken.updateMany).toHaveBeenCalled();
    const again = build({ target: { id: 'staff', role: 'SUPPORT', status: 'SUSPENDED' } });
    await again.service.update('staff', { status: 'ACTIVE' }, ADMIN);
    expect(again.tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('never touches an admin account, the admin themselves, or a non-staff account', async () => {
    await expect(build({ target: { id: 'other-admin', role: 'ADMIN', status: 'ACTIVE' } }).service.update('other-admin', { status: 'SUSPENDED' }, ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(build().service.update('admin', { role: 'HR' }, ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(build({ target: { id: 'c', role: 'CUSTOMER', status: 'ACTIVE' } }).service.update('c', { role: 'MANAGER' }, ADMIN)).rejects.toBeInstanceOf(NotFoundException);
  });
});

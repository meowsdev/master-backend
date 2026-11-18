import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminMembersService } from './admin-members.service';

function build(member: { role?: string; status?: string; isRestricted?: boolean } | null = {}) {
  const tx = {
    user: { update: jest.fn() },
    userModerationLog: { create: jest.fn() },
    refreshToken: { updateMany: jest.fn() },
    orderOffer: { updateMany: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn().mockResolvedValue(member && { id: 'm1', role: 'PROVIDER', status: 'ACTIVE', isRestricted: false, ...member }) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const service = new AdminMembersService(prisma as never, { getDistricts: () => [], getUpazilas: () => [] } as never);
  // The real details are covered by the screen; here only the rules around changing a member matter.
  jest.spyOn(service, 'getDetails').mockResolvedValue({} as never);
  return { service, tx, prisma };
}

const admin = { id: 'admin-1', role: 'ADMIN' };
const manager = { id: 'manager-1', role: 'MANAGER' };

describe('AdminMembersService.moderate', () => {
  it('never lets staff moderate themselves', async () => {
    const { service } = build();
    await expect(service.moderate(admin, 'admin-1', 'BLOCK')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never touches a staff account', async () => {
    const { service } = build({ role: 'ADMIN' });
    await expect(service.moderate(admin, 'm1', 'BAN')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps banning for admins; a manager may still block', async () => {
    const { service } = build();
    await expect(service.moderate(manager, 'm1', 'BAN')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.moderate(manager, 'm1', 'BLOCK')).resolves.toBeDefined();
  });

  it('blocking signs the person out and withdraws the offers they still hold', async () => {
    const { service, tx } = build();
    await service.moderate(admin, 'm1', 'BLOCK', ' abuse ');
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'SUSPENDED' } });
    expect(tx.refreshToken.updateMany).toHaveBeenCalled();
    expect(tx.orderOffer.updateMany).toHaveBeenCalled();
    expect(tx.userModerationLog.create).toHaveBeenCalledWith({ data: { userId: 'm1', actorId: 'admin-1', action: 'BLOCK', reason: 'abuse' } });
  });

  it('restricting keeps the session but withdraws open offers', async () => {
    const { service, tx } = build();
    await service.moderate(admin, 'm1', 'RESTRICT');
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { isRestricted: true } });
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(tx.orderOffer.updateMany).toHaveBeenCalled();
  });

  it('lifting only works from the matching state', async () => {
    await expect(build({ status: 'ACTIVE' }).service.moderate(admin, 'm1', 'UNBLOCK')).rejects.toBeInstanceOf(BadRequestException);
    await expect(build({ status: 'SUSPENDED' }).service.moderate(admin, 'm1', 'UNBAN')).rejects.toBeInstanceOf(BadRequestException);
    await expect(build({ status: 'BANNED' }).service.moderate(admin, 'm1', 'BLOCK')).rejects.toBeInstanceOf(BadRequestException);
    const { service, tx } = build({ status: 'BANNED' });
    await service.moderate(admin, 'm1', 'UNBAN');
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { status: 'ACTIVE' } });
    expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});

describe('AdminMembersService.create', () => {
  function buildCreate(existing: { role: string } | null, validPair = true) {
    const tx = {
      user: { create: jest.fn().mockResolvedValue({ id: 'u-new', role: 'PROVIDER' }) },
      customerProfile: { create: jest.fn() },
      providerProfile: { create: jest.fn().mockResolvedValue({ id: 'pp-new' }) },
      providerServiceArea: { create: jest.fn() },
    };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(existing) }, $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)) };
    const locations = { isValidLocation: jest.fn().mockReturnValue(validPair), getDistricts: () => [], getUpazilas: () => [] };
    return { service: new AdminMembersService(prisma as never, locations as never), tx };
  }
  const provider = { role: 'PROVIDER' as const, mobileNumber: '+8801700000001', name: ' Ali ', companyName: 'Ali Care', districtId: 1, upazilaId: 10 };

  it('creates a provider with the profile and the upazila they take orders in', async () => {
    const { service, tx } = buildCreate(null);
    await service.create(provider);
    expect(tx.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'PROVIDER', status: 'ACTIVE', isVerified: true, name: 'Ali' }) }));
    expect(tx.providerProfile.create).toHaveBeenCalledWith(expect.objectContaining({ data: { userId: 'u-new', companyName: 'Ali Care' } }));
    expect(tx.providerServiceArea.create).toHaveBeenCalledWith({ data: { providerId: 'pp-new', districtId: 1, upazilaId: 10 } });
  });

  it('creates a customer with a customer profile and no provider rows', async () => {
    const { service, tx } = buildCreate(null);
    await service.create({ role: 'CUSTOMER', mobileNumber: '+8801700000002' });
    expect(tx.customerProfile.create).toHaveBeenCalled();
    expect(tx.providerProfile.create).not.toHaveBeenCalled();
  });

  it('keeps one role per phone number', async () => {
    const { service, tx } = buildCreate({ role: 'CUSTOMER' });
    await expect(service.create(provider)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('wants the district and upazila together, and as a real pair', async () => {
    await expect(buildCreate(null).service.create({ ...provider, upazilaId: undefined })).rejects.toBeInstanceOf(BadRequestException);
    await expect(buildCreate(null, false).service.create(provider)).rejects.toBeInstanceOf(BadRequestException);
  });
});

type TechnicianDetails = { technician?: { profileId: string; provider: unknown; orderCount: number } };

describe('AdminMembersService.getDetails for a technician', () => {
  const memberRow = { id: 't-user', role: 'TECHNICIAN', status: 'ACTIVE', isRestricted: false, districtId: null, upazilaId: null, addresses: [], moderationLog: [] };

  function buildTechnician(profile: object) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(memberRow) },
      technicianProfile: { upsert: jest.fn().mockResolvedValue(profile) },
    };
    return { service: new AdminMembersService(prisma as never, { getDistricts: () => [], getUpazilas: () => [] } as never), prisma };
  }

  it('creates the missing technician profile so a provider can be attached', async () => {
    const { service, prisma } = buildTechnician({ id: 'tp-1', lastLoginAt: null, providerAgencyId: null, providerAgency: null, _count: { orders: 0 } });
    const details = (await service.getDetails('t-user')) as unknown as TechnicianDetails;
    expect(prisma.technicianProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 't-user' }, create: { userId: 't-user' } }));
    expect(details.technician).toMatchObject({ profileId: 'tp-1', provider: null, orderCount: 0 });
  });

  it('names the provider the technician works under', async () => {
    const { service } = buildTechnician({
      id: 'tp-1',
      lastLoginAt: null,
      providerAgencyId: 'pp-9',
      providerAgency: { companyName: 'Ali Care', user: { name: 'Ali', username: null, mobileNumber: '+8801700000001' } },
      _count: { orders: 3 },
    });
    const details = (await service.getDetails('t-user')) as unknown as TechnicianDetails;
    expect(details.technician?.provider).toEqual({ profileId: 'pp-9', name: 'Ali Care', mobileNumber: '+8801700000001' });
  });
});

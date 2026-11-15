// @nestjs/jwt ships ESM that Jest cannot load; AuthService only needs the type here.
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocationsService } from '../locations/locations.service';

describe('AuthService.completeProfile (location is optional)', () => {
  const locations = new LocationsService();
  const [district] = locations.getDistricts();
  const [upazila] = locations.getUpazilas(district.id);
  const otherDistrict = locations.getDistricts()[1];

  const buildService = (existing: { name: string | null }) => {
    const update = jest.fn();
    const user = { id: 'u1', role: 'CUSTOMER', email: null, username: null, districtId: null, upazilaId: null, profilePhoto: null, ...existing };
    const prisma = {
      user: {
        findUnique: jest.fn(({ where }) => Promise.resolve(where.id ? user : null)),
        update,
      },
      $transaction: jest.fn((run) => run({ user: { update }, customerProfile: { upsert: jest.fn() } })),
    };
    const service = new AuthService(prisma as never, {} as never, {} as never, locations);
    // ensureProfile and the final read touch tables irrelevant to this rule
    jest.spyOn(service as never, 'ensureProfile').mockResolvedValue(undefined as never);
    jest.spyOn(service, 'getMe').mockResolvedValue({} as never);
    return { service, update };
  };

  const newAccount = { fullName: 'Alif Khan', username: 'alif_khan' };

  it('creates a new account without a location', async () => {
    const { service, update } = buildService({ name: null });
    await expect(service.completeProfile('u1', newAccount)).resolves.toBeDefined();
    expect(update).toHaveBeenCalled();
  });

  it('still requires a username for a new account', async () => {
    const { service } = buildService({ name: null });
    await expect(service.completeProfile('u1', { fullName: 'Alif Khan' })).rejects.toThrow(/username/);
  });

  it('accepts a real district + upazila pair', async () => {
    const { service } = buildService({ name: null });
    await expect(
      service.completeProfile('u1', { ...newAccount, districtId: district.id, upazilaId: upazila.id }),
    ).resolves.toBeDefined();
  });

  it('rejects a district without an upazila', async () => {
    const { service } = buildService({ name: null });
    await expect(
      service.completeProfile('u1', { ...newAccount, districtId: district.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an upazila from another district', async () => {
    const { service } = buildService({ name: null });
    await expect(
      service.completeProfile('u1', { ...newAccount, districtId: otherDistrict.id, upazilaId: upazila.id }),
    ).rejects.toThrow(/does not belong/);
  });

  it('lets an existing user clear the location with both null', async () => {
    const { service } = buildService({ name: 'Alif' });
    await expect(
      service.completeProfile('u1', { districtId: null, upazilaId: null }),
    ).resolves.toBeDefined();
  });

  it('rejects clearing only one half', async () => {
    const { service } = buildService({ name: 'Alif' });
    await expect(
      service.completeProfile('u1', { districtId: null, upazilaId: upazila.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('staff roles cannot be chosen at sign-up', () => {
    it.each(['ADMIN', 'MANAGER', 'SUPPORT', 'TECHNICIAN'])('%s is refused', async (role) => {
      const { service } = buildService({ name: null });
      await expect(
        service.completeProfile('u1', { ...newAccount, role: role as never }),
      ).rejects.toThrow(/can only be granted by an administrator/);
    });

    it.each(['CUSTOMER', 'PROVIDER', 'COUNSELOR'])('%s is still allowed', async (role) => {
      const { service } = buildService({ name: null });
      await expect(
        service.completeProfile('u1', { ...newAccount, role: role as never }),
      ).resolves.toBeDefined();
    });
  });
});

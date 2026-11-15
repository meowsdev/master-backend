import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  assertCanManageTechnicians,
  canManageTechnicians,
  SELF_SERVICE_SIGNUP_ROLES,
} from './role-policy';

describe('role policy: technicians are managed by an ADMIN only', () => {
  it('lets only ADMIN manage technicians', () => {
    for (const role of Object.values(UserRole)) {
      expect(canManageTechnicians(role)).toBe(role === UserRole.ADMIN);
    }
  });

  it('denies a missing role', () => {
    expect(canManageTechnicians(undefined)).toBe(false);
    expect(canManageTechnicians(null)).toBe(false);
  });

  it('throws Forbidden for providers, counselors, customers, technicians, managers and support', () => {
    for (const role of [
      UserRole.PROVIDER,
      UserRole.COUNSELOR,
      UserRole.CUSTOMER,
      UserRole.TECHNICIAN,
      UserRole.MANAGER,
      UserRole.SUPPORT,
    ]) {
      expect(() => assertCanManageTechnicians(role)).toThrow(ForbiddenException);
    }
    expect(() => assertCanManageTechnicians(UserRole.ADMIN)).not.toThrow();
  });

  it('keeps every staff role out of self sign-up', () => {
    for (const role of [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPPORT, UserRole.TECHNICIAN]) {
      expect(SELF_SERVICE_SIGNUP_ROLES).not.toContain(role);
    }
  });
});

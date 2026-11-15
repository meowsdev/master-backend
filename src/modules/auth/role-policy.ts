import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/*
 * Who may do what with roles and technicians. This is the single source of truth
 * (AGENTS.md §10); controllers and services use these, never their own lists.
 */

/**
 * Roles a person may pick for themselves while signing up. Every other role
 * (ADMIN, MANAGER, SUPPORT, TECHNICIAN) is granted by an administrator, otherwise
 * anyone could simply register as one.
 */
export const SELF_SERVICE_SIGNUP_ROLES: readonly UserRole[] = [
  UserRole.CUSTOMER,
  UserRole.PROVIDER,
  UserRole.COUNSELOR,
];

/**
 * Only these roles may create a technician, attach one to a provider, or assign
 * one to an order. Providers, counselors, customers and technicians themselves may not.
 */
export const TECHNICIAN_MANAGER_ROLES: readonly UserRole[] = [UserRole.ADMIN];

export const canManageTechnicians = (role?: UserRole | null): boolean =>
  role !== undefined && role !== null && TECHNICIAN_MANAGER_ROLES.includes(role);

export const TECHNICIAN_MANAGEMENT_DENIED_MESSAGE =
  'Only an administrator can create technicians or assign them to a provider or an order';

/** Throws unless the actor is allowed to manage technicians. */
export function assertCanManageTechnicians(role?: UserRole | null): void {
  if (!canManageTechnicians(role)) {
    throw new ForbiddenException(TECHNICIAN_MANAGEMENT_DENIED_MESSAGE);
  }
}

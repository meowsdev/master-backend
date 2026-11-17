import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/** Platform staff may see contact details; customers, providers and technicians never see each other's. */
const STAFF_ROLES: string[] = [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPPORT, UserRole.HR, UserRole.COUNSELOR];
export const canSeeContactDetails = (role?: string | null) => Boolean(role && STAFF_ROLES.includes(role));

const HIDDEN_KEYS = ['mobileNumber', 'email'] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Removes every phone number and email from a response, except the viewer's own.
 * An object belongs to the viewer when its `id` is theirs (a User row). Plain objects and arrays are
 * walked; dates and Decimal values are left alone.
 */
export function stripContactDetails<T>(value: T, viewerId: string | null): T {
  if (Array.isArray(value)) return value.map((item) => stripContactDetails(item, viewerId)) as T;
  if (!isPlainObject(value)) return value;

  const isViewersOwn = viewerId !== null && value.id === viewerId;
  const cleaned: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!isViewersOwn && (HIDDEN_KEYS as readonly string[]).includes(key)) continue;
    cleaned[key] = stripContactDetails(child, viewerId);
  }
  return cleaned as T;
}

/** Bengali digits become ASCII so "০১৭১১১১১১১১" is caught like "01711111111". */
const toAsciiDigits = (text: string) => text.replace(/[০-৯]/g, (digit) => String('০১২৩৪৫৬৭৮৯'.indexOf(digit)));

/**
 * True when the text carries a phone number: ten or more digits once spaces, dashes, dots and
 * brackets between them are ignored ("017 11-11 11 11", "+880 1711111111", "০১৭১১১১১১১১").
 */
export function containsPhoneNumber(text: string): boolean {
  const joined = toAsciiDigits(text).replace(/(?<=\d)[\s\-.()]+(?=\d)/g, '');
  return /\d{10,}/.test(joined);
}

/** Throws unless the text is free of phone numbers. Used wherever one side writes text the other reads. */
export function assertNoPhoneNumber(text: string | null | undefined) {
  if (text && containsPhoneNumber(text)) {
    throw new BadRequestException('Sharing phone numbers is not allowed. Please keep the conversation in the app.');
  }
}

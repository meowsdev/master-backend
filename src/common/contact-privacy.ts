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

const SEPARATOR = '[\\s\\-.()]*';

/**
 * A Bangladeshi mobile number written with spaces, dashes or brackets: [+88] 01[3-9] and eight more
 * digits. It must start at a number boundary (nothing but a separator before it), so a price list such
 * as "3700 2100 1600 1500" cannot be read as one by gluing digits from different numbers together.
 */
const BD_MOBILE = new RegExp(
  `(?<!\\d)(?:\\+?88${SEPARATOR})?0${SEPARATOR}1${SEPARATOR}[3-9](?:${SEPARATOR}\\d){8}`,
);

/**
 * True when the text carries a phone number: ten or more digits written together, or a Bangladeshi
 * mobile number written in groups ("017 1111 1111", "+880 1711 111111", "017-11-11-11-11", "০১৭১১১১১১১১").
 */
export function containsPhoneNumber(text: string): boolean {
  const ascii = toAsciiDigits(text);
  return /\d{10,}/.test(ascii) || BD_MOBILE.test(ascii);
}

/** Throws unless the text is free of phone numbers. Used wherever one side writes text the other reads. */
export function assertNoPhoneNumber(text: string | null | undefined) {
  if (text && containsPhoneNumber(text)) {
    throw new BadRequestException('Sharing phone numbers is not allowed. Please keep the conversation in the app.');
  }
}

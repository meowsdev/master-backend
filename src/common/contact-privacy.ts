import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/** Platform staff may see contact details; customers, providers and technicians never see each other's. */
const STAFF_ROLES: string[] = [UserRole.ADMIN, UserRole.MANAGER, UserRole.SUPPORT, UserRole.HR, UserRole.COUNSELOR];
export const canSeeContactDetails = (role?: string | null) => Boolean(role && STAFF_ROLES.includes(role));

/** Only an admin sees other people's full phone numbers; everyone else sees them masked ("017****4585"). */
export const canSeeFullPhoneNumbers = (role?: string | null) => role === UserRole.ADMIN;

/**
 * "+8801712344585" -> "017****4585": the local number's first three digits, four stars, the last four.
 * Lets people tell apart users who never set a name or username, without seeing the number.
 */
export function maskPhoneNumber(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('88') && digits.length > 11) digits = digits.slice(2);
  if (digits.length < 8) return '*'.repeat(Math.max(0, digits.length - 4)) + digits.slice(-4);
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

/** How a person is named in a group chat, like WhatsApp: name, else @username, else the masked number. */
export function userDisplayName(user: { name?: string | null; username?: string | null; mobileNumber?: string | null }): string {
  if (user.name?.trim()) return user.name.trim();
  if (user.username?.trim()) return `@${user.username.trim()}`;
  if (user.mobileNumber) return maskPhoneNumber(user.mobileNumber);
  return 'Unknown';
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

/**
 * Hides other people's contact details in a response; the viewer's own stay as they are.
 * - Phone numbers are masked (callers skip this for an admin, see `canSeeFullPhoneNumbers`): `mobileNumber`
 *   becomes "017****4585" (also copied to `maskedPhone`), so people can be told apart without the full number.
 * - Emails are removed, unless `canSeeEmails` (platform staff).
 * An object belongs to the viewer when its `id` is theirs (a User row). Plain objects and arrays are
 * walked; dates and Decimal values are left alone.
 */
export function protectContactDetails<T>(value: T, viewerId: string | null, canSeeEmails = false): T {
  if (Array.isArray(value)) return value.map((item) => protectContactDetails(item, viewerId, canSeeEmails)) as T;
  if (!isPlainObject(value)) return value;

  const isViewersOwn = viewerId !== null && value.id === viewerId;
  if (isViewersOwn) {
    const own: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) own[key] = protectContactDetails(child, viewerId, canSeeEmails);
    return own as T;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'email' && !canSeeEmails) continue;
    if (key === 'mobileNumber' && typeof child === 'string') {
      cleaned.mobileNumber = maskPhoneNumber(child);
      cleaned.maskedPhone = cleaned.mobileNumber;
      continue;
    }
    cleaned[key] = protectContactDetails(child, viewerId, canSeeEmails);
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

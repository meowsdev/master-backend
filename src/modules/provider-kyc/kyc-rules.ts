import { KycStatus, Prisma } from '@prisma/client';
import { join } from 'path';

/**
 * Who may get orders: a provider whose KYC is approved, or one who was working before KYC was required and is still
 * inside their grace period (kycGraceUntil). New providers have no grace: no orders until an admin approves them.
 */
export function kycAllowsOrders(
  provider: { kycGraceUntil: Date | null; kyc: { status: KycStatus } | null },
  now = new Date(),
): boolean {
  if (provider.kyc?.status === KycStatus.APPROVED) return true;
  return provider.kycGraceUntil !== null && provider.kycGraceUntil > now;
}

/** The same rule as a database filter, for picking who is offered an order. */
export const kycAllowsOrdersWhere = (
  now = new Date(),
): Prisma.ProviderProfileWhereInput => ({
  OR: [{ kyc: { status: KycStatus.APPROVED } }, { kycGraceUntil: { gt: now } }],
});

/**
 * A provider account, whichever side the person is on right now: providers, plus customers who are providers too (one
 * number, both sides, switched with Switch Account) or who applied to be one (sent a KYC). A stray provider row on a
 * plain customer is not one.
 */
export const providerAccountWhere = (): Prisma.ProviderProfileWhereInput => ({
  OR: [
    { user: { role: 'PROVIDER' } },
    {
      user: { role: 'CUSTOMER' },
      OR: [{ kyc: { isNot: null } }, { kycGraceUntil: { not: null } }],
    },
  ],
});

/**
 * NID pictures and the provider's photo live here, outside the public `uploads` folder: nothing serves this folder,
 * so a file is reachable only through GET /provider-kyc/files/:key, which checks who is asking.
 */
export const KYC_FILE_DIR = join(process.cwd(), 'private-uploads', 'kyc');
export const KYC_FILE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];

/** A file key is "<the uploader's user id>_<random>.<ext>": the owner is part of the name and cannot be forged. */
const KEY_PATTERN = /^([0-9a-f-]{36})_[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/i;

export function kycFileOwner(key: string): string | null {
  return KEY_PATTERN.exec(key)?.[1] ?? null;
}

/** Bangladeshi mobile in the form the app stores: +8801XXXXXXXXX. null when it is not one. */
export function normalizeBdMobile(phone: string): string | null {
  const match = /^(?:\+?880|0)?(1[3-9]\d{8})$/.exec(
    phone.replace(/[\s-]/g, ''),
  );
  return match ? `+880${match[1]}` : null;
}

/** A Bangladeshi NID number: 10 (smart card), 13 or 17 digits (older cards). */
export const isValidNid = (nid: string) => /^(\d{10}|\d{13}|\d{17})$/.test(nid);

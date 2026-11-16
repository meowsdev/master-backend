import { randomInt } from 'crypto';
import { Prisma } from '@prisma/client';

/** 26 letters + 10 digits: 36^6 = 2,176,782,336 possible references (e.g. A94K2B, 7X2M9P). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const REFERENCE_LENGTH = 6;
const MAX_ATTEMPTS = 8;

export function generateOrderReferenceCode(): string {
  // randomInt is unbiased, unlike `Math.random() * 36`.
  return Array.from({ length: REFERENCE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

/**
 * Runs `create` with a fresh random reference. If the database says that reference
 * is already taken (a 1-in-2-billion event per order), it simply tries another one.
 */
export async function createWithUniqueReference<T>(create: (referenceCode: string) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await create(generateOrderReferenceCode());
    } catch (error) {
      const isReferenceClash =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        String(error.meta?.target ?? '').includes('referenceCode');
      if (!isReferenceClash || attempt >= MAX_ATTEMPTS) throw error;
    }
  }
}

/**
 * For code that already runs inside a transaction (a unique-violation there would abort
 * the whole transaction, so retrying like above is impossible): look for a free code first.
 */
export async function findFreeReferenceCode(db: {
  order: { findUnique: (args: { where: { referenceCode: string }; select: { id: true } }) => Promise<unknown> };
}): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const referenceCode = generateOrderReferenceCode();
    const taken = await db.order.findUnique({ where: { referenceCode }, select: { id: true } });
    if (!taken) return referenceCode;
  }
  throw new Error('Could not allocate an order reference');
}

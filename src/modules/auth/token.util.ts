import { createHash, randomBytes } from 'crypto';

/** Opaque 512-bit refresh token; only its SHA-256 hash is ever stored. */
export function generateRefreshToken(): string {
  return randomBytes(64).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

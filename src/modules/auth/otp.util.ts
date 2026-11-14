import { createHash, randomInt } from 'crypto';

export const OTP_LENGTH = 6;

export function generateOtpCode(): string {
  // randomInt is cryptographically secure, unlike Math.random().
  return randomInt(10 ** (OTP_LENGTH - 1), 10 ** OTP_LENGTH).toString();
}

export function hashOtpCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

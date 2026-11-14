/** Env-driven OTP limits, read lazily so ConfigModule's `.env` is already loaded. */

function readPositiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const getOtpConfig = () => ({
  expiresInSeconds: readPositiveInt('OTP_EXPIRES_IN_SECONDS', 180),
  resendCooldownSeconds: readPositiveInt('OTP_RESEND_COOLDOWN_SECONDS', 300),
  maxSendsPerDay: readPositiveInt('OTP_MAX_SENDS_PER_DAY', 5),
  maxVerifyAttempts: readPositiveInt('OTP_MAX_VERIFY_ATTEMPTS', 5),
  ipMaxSendsPerHour: readPositiveInt('OTP_IP_MAX_SENDS_PER_HOUR', 20),
  // Dev convenience only: returning/logging the code defeats hashing.
  exposeCode: process.env.OTP_EXPOSE_CODE === 'true',
});

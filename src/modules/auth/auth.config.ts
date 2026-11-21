/**
 * Central, env-driven auth configuration.
 *
 * Values are read lazily (on every call) instead of at import time, because
 * ConfigModule loads `.env` after this file is first imported.
 */

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type CookieSameSite = 'lax' | 'strict' | 'none';

function readPositiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** `JWT_SECRET` is the legacy name, kept so existing deployments keep working. */
export function getAccessSecret(): string {
  const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'JWT_ACCESS_SECRET is not set. Refusing to start without a signing secret.',
    );
  }
  return secret;
}

export function getAccessExpiresIn(): string {
  return process.env.JWT_ACCESS_EXPIRES_IN || '30d';
}

export function getRefreshLifetimeMs(): number {
  return readPositiveInt('REFRESH_TOKEN_EXPIRES_IN_DAYS', 365) * DAY_IN_MS;
}

/** Window in which a just-rotated token is still accepted (parallel tabs). */
export function getRefreshGraceMs(): number {
  return readPositiveInt('REFRESH_GRACE_PERIOD_SECONDS', 30) * 1000;
}

export function getCookieOptions() {
  const sameSiteEnv = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
  const sameSite: CookieSameSite =
    sameSiteEnv === 'none' || sameSiteEnv === 'strict' ? sameSiteEnv : 'lax';
  const isProduction = process.env.NODE_ENV === 'production';
  // SameSite=None is rejected by browsers unless the cookie is also Secure.
  const secure =
    process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === 'true'
      : isProduction;

  return {
    sameSite,
    secure: secure || sameSite === 'none',
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

/**
 * Empty list means "allow any origin": CORS then reflects the request origin.
 * `FRONTEND_ORIGINS=*` (or leaving it unset) allows every origin.
 */
export function getFrontendOrigins(): string[] {
  const origins = (process.env.FRONTEND_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins.includes('*') ? [] : origins;
}

import type { Response } from 'express';
import { getCookieOptions } from './auth.config';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
// Carries no secret. The refresh cookie is path-scoped to the auth routes, so
// the Next.js proxy can never see it; this marker (path `/`, refresh lifetime)
// lets the proxy tell "access token expired, refresh pending" from "logged out".
export const SESSION_HINT_COOKIE = 'session_active';

// The app sets a global `/api/v1` prefix, so the refresh cookie is only ever
// sent to the auth routes (refresh/logout) and not on every API call.
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface AuthCookieTokens {
  accessToken: string;
  refreshToken: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
}

/** Called on login AND every rotation so both lifetimes slide forward. */
export function setAuthCookies(res: Response, tokens: AuthCookieTokens) {
  const base = { httpOnly: true, ...getCookieOptions() };

  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    path: '/',
    maxAge: tokens.accessMaxAgeMs,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    path: REFRESH_COOKIE_PATH,
    maxAge: tokens.refreshMaxAgeMs,
  });
  res.cookie(SESSION_HINT_COOKIE, '1', {
    ...base,
    path: '/',
    maxAge: tokens.refreshMaxAgeMs,
  });
}

export function clearAuthCookies(res: Response) {
  const base = { httpOnly: true, ...getCookieOptions() };
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_COOKIE_PATH });
  res.clearCookie(SESSION_HINT_COOKIE, { ...base, path: '/' });
}

export function readCookie(
  req: { cookies?: Record<string, unknown> },
  name: string,
): string | undefined {
  const value = req.cookies?.[name];
  return typeof value === 'string' && value ? value : undefined;
}

/** Bearer wins over the cookie so legacy (technician) sessions keep working. */
export function extractAccessToken(req: {
  headers: { authorization?: string };
  cookies?: Record<string, unknown>;
}): string | undefined {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  return bearer || readCookie(req, ACCESS_COOKIE);
}

/** Raw `Cookie:` header parser for places cookie-parser does not run (WebSocket handshake). */
export function readCookieFromHeader(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim()) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

jest.mock('@nestjs/passport', () => ({ AuthGuard: () => class {} }));
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));

import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';

const tokens = {
  accessToken: 'access.jwt',
  refreshToken: 'r'.repeat(128),
  accessMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
  refreshMaxAgeMs: 365 * 24 * 60 * 60 * 1000,
};

function build() {
  const authService = {
    verifyOtp: jest.fn().mockResolvedValue({ user: { id: 'u1' }, tokens }),
  } as unknown as jest.Mocked<AuthService>;
  const sessions = {
    rotate: jest.fn().mockResolvedValue(tokens),
    logout: jest.fn().mockResolvedValue(undefined),
    revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SessionsService>;
  const res = { cookie: jest.fn(), clearCookie: jest.fn() } as any;
  const req = (extra: Record<string, unknown> = {}) =>
    ({ headers: {}, ip: '1.1.1.1', cookies: {}, ...extra }) as any;
  return {
    controller: new AuthController(authService, sessions),
    sessions,
    res,
    req,
  };
}

describe('AuthController cookies', () => {
  it('login sets httpOnly cookies and keeps tokens out of the body', async () => {
    const { controller, res, req } = build();

    const body = await controller.verifyOtp(
      { phoneNumber: '+8801700000000', code: '1234' } as any,
      req(),
      res,
    );

    expect(body).toEqual({ user: { id: 'u1' } });
    const [access, refresh, hint] = res.cookie.mock.calls;
    expect(hint[0]).toBe('session_active');
    expect(hint[2]).toMatchObject({
      httpOnly: true,
      path: '/',
      maxAge: tokens.refreshMaxAgeMs,
    });
    expect(access[0]).toBe('access_token');
    expect(access[2]).toMatchObject({
      httpOnly: true,
      path: '/',
      maxAge: tokens.accessMaxAgeMs,
    });
    expect(refresh[0]).toBe('refresh_token');
    expect(refresh[2]).toMatchObject({
      httpOnly: true,
      path: '/api/v1/auth',
      maxAge: tokens.refreshMaxAgeMs,
    });
  });

  it('refresh rotates the cookie token and re-sets both cookies', async () => {
    const { controller, sessions, res, req } = build();

    await controller.refresh(
      {},
      req({ cookies: { refresh_token: 'old'.repeat(20) } }),
      res,
    );

    expect(sessions.rotate).toHaveBeenCalledWith(
      'old'.repeat(20),
      expect.any(Object),
    );
    expect(res.cookie).toHaveBeenCalledTimes(3); // access, refresh, session hint
  });

  it('refresh without any token is 401', async () => {
    const { controller, res, req } = build();
    await expect(controller.refresh({}, req(), res)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refresh via legacy body token returns tokens and sets no cookies', async () => {
    const { controller, res, req } = build();

    const body = await controller.refresh(
      { refreshToken: 'legacy'.repeat(10) },
      req(),
      res,
    );

    expect(body).toEqual({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('logout revokes the session and clears both cookies', async () => {
    const { controller, sessions, res, req } = build();

    await controller.logout(
      {},
      req({ cookies: { refresh_token: 'rt'.repeat(30), access_token: 'at' } }),
      res,
    );

    expect(sessions.logout).toHaveBeenCalledWith('rt'.repeat(30), 'at');
    expect(res.clearCookie).toHaveBeenCalledWith(
      'access_token',
      expect.objectContaining({ path: '/' }),
    );
    expect(res.clearCookie).toHaveBeenCalledWith(
      'refresh_token',
      expect.objectContaining({ path: '/api/v1/auth' }),
    );
  });
});

jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => undefined,
  CronExpression: { EVERY_DAY_AT_3AM: '0 3 * * *' },
}));
// @nestjs/jwt is ESM-only and cannot be loaded by ts-jest, so use a tiny fake
// that keeps the sign/decode/verify contract SessionsService relies on.
jest.mock('@nestjs/jwt', () => {
  const encode = (payload: object) =>
    `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
  const decode = (token: string) => {
    const part = token.split('.')[1];
    if (!part) throw new Error('jwt malformed');
    return JSON.parse(Buffer.from(part, 'base64url').toString());
  };
  class JwtService {
    signAsync(payload: object) {
      const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      return Promise.resolve(encode({ ...payload, exp }));
    }
    decode(token: string) {
      return decode(token);
    }
    verifyAsync(token: string) {
      return Promise.resolve().then(() => decode(token));
    }
  }
  return { JwtService };
});

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SessionsService } from './sessions.service';
import { TokenCleanupService } from './token-cleanup.service';
import { hashToken } from './token.util';

interface TokenRow {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedByTokenId: string | null;
  lastUsedAt: Date;
  user?: unknown;
}

const USER = { id: 'user-1', mobileNumber: '+8801700000000', role: 'CUSTOMER' };

/** Minimal in-memory stand-in for the parts of Prisma the service touches. */
function createFakePrisma(status = 'ACTIVE') {
  const rows: TokenRow[] = [];
  let sequence = 0;

  const matches = (row: TokenRow, where: Record<string, any>) =>
    Object.entries(where).every(([key, value]) => {
      if (value === null) return row[key as keyof TokenRow] === null;
      if (key === 'OR') return false;
      return row[key as keyof TokenRow] === value;
    });

  const refreshToken = {
    create: jest.fn(({ data }: any) => {
      const row: TokenRow = {
        id: `token-${++sequence}`,
        revokedAt: null,
        replacedByTokenId: null,
        lastUsedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return Promise.resolve({ id: row.id });
    }),
    findUnique: jest.fn(({ where }: any) => {
      const row = rows.find((r) => r.tokenHash === where.tokenHash);
      return Promise.resolve(
        row ? { ...row, user: { ...USER, status } } : null,
      );
    }),
    update: jest.fn(({ where, data }: any) => {
      Object.assign(
        rows.find((r) => r.id === where.id)!,
        data,
      );
      return Promise.resolve();
    }),
    updateMany: jest.fn(({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return Promise.resolve({ count: hit.length });
    }),
  };

  const prisma: any = {
    refreshToken,
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  // Not a real transaction: the fake has no rollback, which is exactly why the
  // service must throw *after* the callback returns for reuse detection.
  prisma.$transaction = jest.fn((callback: any) => callback(prisma));

  return { prisma: prisma as PrismaService, rows };
}

function build(status = 'ACTIVE') {
  const { prisma, rows } = createFakePrisma(status);
  const redis = { set: jest.fn() } as unknown as RedisService;
  const jwt = new JwtService();
  return { service: new SessionsService(prisma, jwt, redis), rows, redis, jwt };
}

const familyRows = (rows: TokenRow[], familyId: string) =>
  rows.filter((row) => row.familyId === familyId);

describe('SessionsService', () => {
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-secret';
    process.env.REFRESH_GRACE_PERIOD_SECONDS = '30';
    process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS = '365';
  });

  afterEach(() => jest.useRealTimers());

  describe('login', () => {
    it('creates a session storing only the hash, with a 1 year expiry', async () => {
      const { service, rows } = build();
      const before = Date.now();

      const tokens = await service.createSession(USER, {
        ipAddress: '1.1.1.1',
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(hashToken(tokens.refreshToken));
      expect(rows[0].tokenHash).not.toBe(tokens.refreshToken);
      expect(tokens.refreshToken).toHaveLength(128);
      const yearMs = 365 * 24 * 60 * 60 * 1000;
      expect(rows[0].expiresAt.getTime() - before).toBeGreaterThanOrEqual(
        yearMs - 1000,
      );
      expect(tokens.accessMaxAgeMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    });

    it('gives every login its own family (multi-device)', async () => {
      const { service, rows } = build();
      await service.createSession(USER);
      await service.createSession(USER);
      expect(new Set(rows.map((r) => r.familyId)).size).toBe(2);
    });
  });

  describe('refresh rotation', () => {
    it('issues a new pair, revokes the old token and chains them', async () => {
      const { service, rows } = build();
      const first = await service.createSession(USER);

      const second = await service.rotate(first.refreshToken);

      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(rows).toHaveLength(2);
      expect(rows[0].revokedAt).not.toBeNull();
      expect(rows[0].replacedByTokenId).toBe(rows[1].id);
      expect(rows[1].revokedAt).toBeNull();
      expect(rows[1].familyId).toBe(rows[0].familyId);
    });

    it('slides the expiry: the new token lives a full year from rotation', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2027-01-01T00:00:00Z'));
      const { service, rows } = build();
      const first = await service.createSession(USER);

      jest.setSystemTime(new Date('2027-10-01T00:00:00Z'));
      await service.rotate(first.refreshToken);

      const yearMs = 365 * 24 * 60 * 60 * 1000;
      expect(rows[1].expiresAt.getTime()).toBe(Date.now() + yearMs);
      expect(rows[1].expiresAt.getTime()).toBeGreaterThan(
        rows[0].expiresAt.getTime(),
      );
    });

    it('keeps a user logged in across many rotations over years', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2027-01-01T00:00:00Z'));
      const { service } = build();
      let current = await service.createSession(USER);

      for (let i = 0; i < 5; i++) {
        jest.setSystemTime(Date.now() + 300 * 24 * 60 * 60 * 1000);
        current = await service.rotate(current.refreshToken);
      }
      expect(current.refreshToken).toBeDefined();
    });
  });

  describe('reuse detection', () => {
    it('revokes the whole family and returns 401 when an old token is replayed late', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const { service, rows } = build();
      const first = await service.createSession(USER);
      const second = await service.rotate(first.refreshToken);

      jest.setSystemTime(Date.now() + 31_000);

      await expect(service.rotate(first.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(familyRows(rows, rows[0].familyId).every((r) => r.revokedAt)).toBe(
        true,
      );
      // The attacker's replay also killed the legitimate newest token.
      await expect(service.rotate(second.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('does not touch other devices when one family is compromised', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const { service, rows } = build();
      const deviceA = await service.createSession(USER);
      const deviceB = await service.createSession(USER);
      await service.rotate(deviceA.refreshToken);
      jest.setSystemTime(Date.now() + 60_000);

      await expect(service.rotate(deviceA.refreshToken)).rejects.toThrow();

      const deviceBRow = rows.find(
        (r) => r.tokenHash === hashToken(deviceB.refreshToken),
      )!;
      expect(deviceBRow.revokedAt).toBeNull();
    });
  });

  describe('grace period', () => {
    it('accepts a just-rotated token without revoking the family', async () => {
      const { service, rows } = build();
      const first = await service.createSession(USER);
      const winner = await service.rotate(first.refreshToken);

      const loser = await service.rotate(first.refreshToken);

      expect(loser.refreshToken).not.toBe(winner.refreshToken);
      // Both resulting tokens stay usable, whichever cookie the browser keeps.
      const live = rows.filter((r) => r.revokedAt === null);
      expect(live).toHaveLength(2);
      await expect(service.rotate(winner.refreshToken)).resolves.toBeDefined();
      await expect(service.rotate(loser.refreshToken)).resolves.toBeDefined();
    });

    it('stops accepting the old token once the grace window has passed', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const { service } = build();
      const first = await service.createSession(USER);
      await service.rotate(first.refreshToken);

      jest.setSystemTime(Date.now() + 29_000);
      await expect(service.rotate(first.refreshToken)).resolves.toBeDefined();

      jest.setSystemTime(Date.now() + 2_000);
      await expect(service.rotate(first.refreshToken)).rejects.toThrow();
    });
  });

  describe('invalid and expired tokens', () => {
    it('rejects an unknown token with a generic 401', async () => {
      const { service } = build();
      await expect(service.rotate('x'.repeat(128))).rejects.toThrow(
        'Session expired, please login again',
      );
    });

    it('rejects an expired refresh token', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const { service } = build();
      const first = await service.createSession(USER);

      jest.setSystemTime(Date.now() + 366 * 24 * 60 * 60 * 1000);

      await expect(service.rotate(first.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects tokens of deactivated users', async () => {
      const { service } = build('INACTIVE');
      const first = await service.createSession(USER);
      await expect(service.rotate(first.refreshToken)).rejects.toThrow();
    });

    it('uses the same message for unknown tokens and detected reuse', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      const { service } = build();
      const first = await service.createSession(USER);
      await service.rotate(first.refreshToken);
      jest.setSystemTime(Date.now() + 60_000);

      const reuse = await service
        .rotate(first.refreshToken)
        .catch((e) => e.message);
      const unknown = await service
        .rotate('y'.repeat(128))
        .catch((e) => e.message);
      expect(reuse).toBe(unknown);
    });
  });

  describe('logout', () => {
    it('revokes the whole family so the refresh token cannot be used again', async () => {
      const { service, rows } = build();
      const first = await service.createSession(USER);
      const second = await service.rotate(first.refreshToken);

      await service.logout(second.refreshToken);

      expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
      await expect(service.rotate(second.refreshToken)).rejects.toThrow();
    });

    it('blacklists the access token for its remaining life and revokes via sid', async () => {
      const { service, rows, redis } = build();
      const tokens = await service.createSession(USER);

      await service.logout(undefined, tokens.accessToken);

      expect(rows[0].revokedAt).not.toBeNull();
      expect(redis.set).toHaveBeenCalledWith(
        `auth:blacklist:access:${tokens.accessToken}`,
        '1',
        expect.any(Number),
      );
    });

    it('is a no-op for unknown credentials (idempotent logout)', async () => {
      const { service } = build();
      await expect(
        service.logout('z'.repeat(128), 'garbage'),
      ).resolves.toBeUndefined();
    });

    it('logout-all revokes every device of the user', async () => {
      const { service, rows } = build();
      await service.createSession(USER);
      await service.createSession(USER);
      await service.revokeAllForUser(USER.id);
      expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    });
  });
});

describe('TokenCleanupService', () => {
  it('deletes expired tokens and long-revoked tokens', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
    const service = new TokenCleanupService({
      refreshToken: { deleteMany },
    } as unknown as PrismaService);

    await expect(service.deleteStaleRefreshTokens()).resolves.toBe(3);

    const where = deleteMany.mock.calls[0][0].where;
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toHaveProperty('expiresAt.lt');
    expect(where.OR[1]).toHaveProperty('revokedAt.lt');
  });
});

import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { OtpThrottledException } from './otp-throttled.exception';
import { OtpService } from './otp.service';
import { hashOtpCode } from './otp.util';

interface OtpRow {
  phoneNumber: string;
  codeHash: string | null;
  expiresAt: Date | null;
  attempts: number;
  consumedAt: Date | null;
  lastSentAt: Date;
  dailyWindowStart: Date;
  dailySendCount: number;
}

const PHONE = '+8801700000000';

/**
 * In-memory Prisma stand-in. Transactions run one at a time, which is the
 * observable effect of `SELECT ... FOR UPDATE` on the same row.
 */
function createFakePrisma() {
  const rows = new Map<string, OtpRow>();
  let queue: Promise<unknown> = Promise.resolve();

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    otpRequest: {
      createMany: jest.fn(({ data }: { data: Partial<OtpRow>[] }) => {
        for (const item of data) {
          if (item.phoneNumber && !rows.has(item.phoneNumber)) {
            rows.set(item.phoneNumber, {
              codeHash: null,
              expiresAt: null,
              attempts: 0,
              consumedAt: null,
              dailySendCount: 0,
              ...item,
            } as OtpRow);
          }
        }
        return Promise.resolve({ count: 1 });
      }),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(rows.get(where.phoneNumber) ?? null),
      ),
      findUniqueOrThrow: jest.fn(({ where }: any) =>
        Promise.resolve(rows.get(where.phoneNumber)!),
      ),
      update: jest.fn(({ where, data }: any) => {
        Object.assign(rows.get(where.phoneNumber)!, data);
        return Promise.resolve();
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(
      (callback: (client: typeof tx) => Promise<unknown>) => {
        const run = queue.then(() => callback(tx));
        queue = run.catch(() => undefined); // keep the queue alive after a throw
        return run;
      },
    ),
  };

  return { prisma: prisma as unknown as PrismaService, rows };
}

function build(
  redisOverrides: Partial<Record<keyof RedisService, jest.Mock>> = {},
) {
  const { prisma, rows } = createFakePrisma();
  const counters = new Map<string, number>();
  const redis = {
    incr: jest.fn((key: string) => {
      counters.set(key, (counters.get(key) ?? 0) + 1);
      return Promise.resolve(counters.get(key)!);
    }),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(3000),
    ...redisOverrides,
  } as unknown as RedisService;
  return { service: new OtpService(prisma, redis), rows, redis };
}

const advance = (ms: number) => jest.setSystemTime(Date.now() + ms);
const throttled = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected the request to be throttled');
    },
    (error: unknown) => error as OtpThrottledException,
  );
const verifyCode = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error: BadRequestException) =>
      (error.getResponse() as { code: string }).code,
  );

describe('OtpService', () => {
  beforeAll(() => {
    Object.assign(process.env, {
      OTP_EXPIRES_IN_SECONDS: '180',
      OTP_RESEND_COOLDOWN_SECONDS: '300',
      OTP_MAX_SENDS_PER_DAY: '5',
      OTP_MAX_VERIFY_ATTEMPTS: '5',
      OTP_IP_MAX_SENDS_PER_HOUR: '20',
    });
  });

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2027-01-01T00:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  describe('sending', () => {
    it('stores only a hash and reports when resend is allowed', async () => {
      const { service, rows } = build();

      const result = await service.send(PHONE, '1.1.1.1');

      expect(rows.get(PHONE)!.codeHash).toBe(hashOtpCode(result.code));
      expect(rows.get(PHONE)!.codeHash).not.toBe(result.code);
      expect(result.retryAfterSeconds).toBe(300);
      expect(result.nextAllowedAt).toBe('2027-01-01T00:05:00.000Z');
      expect(result.expiresInSeconds).toBe(180);
    });

    it('blocks a second send during the cooldown with 429 details', async () => {
      const { service } = build();
      await service.send(PHONE);
      advance(113_000);

      const error = await throttled(service.send(PHONE));

      expect(error.getStatus()).toBe(429);
      expect(error.reason).toBe('COOLDOWN');
      expect(error.retryAfterSeconds).toBe(187);
      expect(error.getResponse()).toMatchObject({
        message: 'Please wait before requesting a new OTP',
        retryAfterSeconds: 187,
        nextAllowedAt: '2027-01-01T00:05:00.000Z',
      });
    });

    it('allows a resend once the cooldown has passed', async () => {
      const { service } = build();
      await service.send(PHONE);
      advance(300_000);

      await expect(service.send(PHONE)).resolves.toBeDefined();
    });

    it('does not mix cooldowns between different phone numbers', async () => {
      const { service } = build();
      await service.send(PHONE);
      await expect(service.send('+8801800000000')).resolves.toBeDefined();
    });

    it('invalidates the previous OTP when a new one is sent', async () => {
      const { service } = build();
      const first = await service.send(PHONE);
      advance(300_000);
      const second = await service.send(PHONE);

      expect(await verifyCode(service.verify(PHONE, first.code))).toBe(
        'OTP_INVALID',
      );
      await expect(service.verify(PHONE, second.code)).resolves.toBeUndefined();
    });

    it('rejects sends beyond the daily limit, until the 24h window passes', async () => {
      const { service } = build();
      for (let i = 0; i < 5; i++) {
        await service.send(PHONE);
        advance(300_000);
      }

      const error = await throttled(service.send(PHONE));
      expect(error.reason).toBe('DAILY_LIMIT');
      expect(error.getStatus()).toBe(429);

      advance(24 * 60 * 60 * 1000);
      await expect(service.send(PHONE)).resolves.toBeDefined();
    });

    it('lets only one of many simultaneous requests through', async () => {
      const { service, rows } = build();

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => service.send(PHONE)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failures = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(failures).toHaveLength(7);
      expect(
        failures.every((f) => f.reason instanceof OtpThrottledException),
      ).toBe(true);
      expect(rows.get(PHONE)!.dailySendCount).toBe(1);
    });

    it('limits requests per IP across different phone numbers', async () => {
      const { service } = build();
      for (let i = 0; i < 20; i++) {
        await service.send(
          `+88017000000${String(i).padStart(2, '0')}`,
          '9.9.9.9',
        );
      }

      const error = await throttled(service.send('+8801999999999', '9.9.9.9'));
      expect(error.reason).toBe('IP_LIMIT');
      // A different IP is unaffected.
      await expect(
        service.send('+8801999999998', '8.8.8.8'),
      ).resolves.toBeDefined();
    });

    it('fails open when Redis is unavailable', async () => {
      const { service } = build({
        incr: jest.fn().mockRejectedValue(new Error('redis down')),
      });
      await expect(service.send(PHONE, '1.1.1.1')).resolves.toBeDefined();
    });
  });

  describe('verifying', () => {
    it('accepts the right code once, then treats it as used', async () => {
      const { service } = build();
      const { code } = await service.send(PHONE);

      await expect(service.verify(PHONE, code)).resolves.toBeUndefined();
      expect(await verifyCode(service.verify(PHONE, code))).toBe('OTP_EXPIRED');
    });

    it('invalidates the OTP after the 5th wrong attempt', async () => {
      const { service } = build();
      const { code } = await service.send(PHONE);

      for (let i = 0; i < 4; i++) {
        expect(await verifyCode(service.verify(PHONE, '000000'))).toBe(
          'OTP_INVALID',
        );
      }
      expect(await verifyCode(service.verify(PHONE, '000000'))).toBe(
        'OTP_TOO_MANY_ATTEMPTS',
      );

      // Even the correct code no longer works.
      expect(await verifyCode(service.verify(PHONE, code))).toBe('OTP_EXPIRED');
    });

    it('still enforces the resend cooldown after attempts ran out', async () => {
      const { service } = build();
      await service.send(PHONE);
      for (let i = 0; i < 5; i++)
        await verifyCode(service.verify(PHONE, '000000'));

      const error = await throttled(service.send(PHONE));
      expect(error.reason).toBe('COOLDOWN');
    });

    it('reports how many attempts are left', async () => {
      const { service } = build();
      await service.send(PHONE);

      const error = await service
        .verify(PHONE, '000000')
        .catch((e: BadRequestException) => e);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'OTP_INVALID',
        attemptsLeft: 4,
      });
    });

    it('rejects an expired OTP', async () => {
      const { service } = build();
      const { code } = await service.send(PHONE);
      advance(181_000);

      expect(await verifyCode(service.verify(PHONE, code))).toBe('OTP_EXPIRED');
    });

    it('rejects a number that never requested an OTP', async () => {
      const { service } = build();
      expect(await verifyCode(service.verify(PHONE, '123456'))).toBe(
        'OTP_EXPIRED',
      );
    });

    it('resets the attempt counter on resend', async () => {
      const { service } = build();
      await service.send(PHONE);
      for (let i = 0; i < 4; i++)
        await verifyCode(service.verify(PHONE, '000000'));
      advance(300_000);
      const { code } = await service.send(PHONE);

      await expect(service.verify(PHONE, code)).resolves.toBeUndefined();
    });
  });
});

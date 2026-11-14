import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { getOtpConfig } from './otp.config';
import { OtpThrottledException } from './otp-throttled.exception';
import { generateOtpCode, hashOtpCode } from './otp.util';

const DAY_MS = 24 * 60 * 60 * 1000;
const IP_WINDOW_SECONDS = 60 * 60;

export interface OtpSendResult {
  /** Plaintext code: only populated when OTP_EXPOSE_CODE=true (dev). */
  code: string;
  expiresInSeconds: number;
  retryAfterSeconds: number;
  nextAllowedAt: string;
}

type VerifyOutcome = 'OK' | 'EXPIRED' | 'INVALID' | 'TOO_MANY_ATTEMPTS';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Creates a new OTP, enforcing IP limit, resend cooldown and daily cap.
   *
   * The phone's row is locked with SELECT ... FOR UPDATE, so two simultaneous
   * requests are serialized and the second one sees the first one's
   * `lastSentAt` instead of both passing the cooldown check.
   */
  async send(phoneNumber: string, ip?: string): Promise<OtpSendResult> {
    const config = getOtpConfig();
    await this.enforceIpLimit(ip);

    const code = generateOtpCode();

    const nextAllowedAt = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // No-op when the row exists; guarantees there is a row to lock.
      await tx.otpRequest.createMany({
        data: [
          {
            phoneNumber,
            lastSentAt: new Date(0),
            dailyWindowStart: now,
          },
        ],
        skipDuplicates: true,
      });
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "OtpRequest" WHERE "phoneNumber" = ${phoneNumber} FOR UPDATE`,
      );
      const row = await tx.otpRequest.findUniqueOrThrow({
        where: { phoneNumber },
      });

      const cooldownEndsAt = new Date(
        row.lastSentAt.getTime() + config.resendCooldownSeconds * 1000,
      );
      if (cooldownEndsAt > now) {
        throw new OtpThrottledException(
          'COOLDOWN',
          (cooldownEndsAt.getTime() - now.getTime()) / 1000,
          cooldownEndsAt,
        );
      }

      const isWindowExpired =
        now.getTime() - row.dailyWindowStart.getTime() >= DAY_MS;
      const windowStart = isWindowExpired ? now : row.dailyWindowStart;
      const sendsInWindow = isWindowExpired ? 0 : row.dailySendCount;

      if (sendsInWindow >= config.maxSendsPerDay) {
        const windowEndsAt = new Date(windowStart.getTime() + DAY_MS);
        throw new OtpThrottledException(
          'DAILY_LIMIT',
          (windowEndsAt.getTime() - now.getTime()) / 1000,
          windowEndsAt,
        );
      }

      // Overwriting the hash and resetting attempts/consumedAt is what
      // invalidates any previous, still-unused OTP.
      await tx.otpRequest.update({
        where: { phoneNumber },
        data: {
          codeHash: hashOtpCode(code),
          expiresAt: new Date(now.getTime() + config.expiresInSeconds * 1000),
          attempts: 0,
          consumedAt: null,
          lastSentAt: now,
          dailyWindowStart: windowStart,
          dailySendCount: sendsInWindow + 1,
        },
      });

      return new Date(now.getTime() + config.resendCooldownSeconds * 1000);
    });

    return {
      code,
      expiresInSeconds: config.expiresInSeconds,
      retryAfterSeconds: config.resendCooldownSeconds,
      nextAllowedAt: nextAllowedAt.toISOString(),
    };
  }

  /** Throws a 400 with a machine-readable `code`; resolves when the OTP is valid. */
  async verify(phoneNumber: string, code: string): Promise<void> {
    const config = getOtpConfig();

    // Outcome is returned (not thrown) so the attempt counter commits even
    // for failures; throwing inside the transaction would roll it back.
    const { outcome, attemptsLeft } = await this.prisma.$transaction(
      async (tx): Promise<{ outcome: VerifyOutcome; attemptsLeft: number }> => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "OtpRequest" WHERE "phoneNumber" = ${phoneNumber} FOR UPDATE`,
        );
        const row = await tx.otpRequest.findUnique({ where: { phoneNumber } });
        const now = new Date();

        const isUsable =
          row?.codeHash &&
          !row.consumedAt &&
          row.expiresAt &&
          row.expiresAt > now;
        if (!row || !isUsable) return { outcome: 'EXPIRED', attemptsLeft: 0 };

        if (row.codeHash === hashOtpCode(code)) {
          await tx.otpRequest.update({
            where: { phoneNumber },
            data: { consumedAt: now },
          });
          return { outcome: 'OK', attemptsLeft: 0 };
        }

        const attempts = row.attempts + 1;
        const isExhausted = attempts >= config.maxVerifyAttempts;
        await tx.otpRequest.update({
          where: { phoneNumber },
          data: { attempts, consumedAt: isExhausted ? now : null },
        });
        return isExhausted
          ? { outcome: 'TOO_MANY_ATTEMPTS', attemptsLeft: 0 }
          : {
              outcome: 'INVALID',
              attemptsLeft: config.maxVerifyAttempts - attempts,
            };
      },
    );

    if (outcome === 'OK') return;
    if (outcome === 'TOO_MANY_ATTEMPTS') {
      throw new BadRequestException({
        message: 'Too many incorrect attempts. Please request a new OTP.',
        code: 'OTP_TOO_MANY_ATTEMPTS',
      });
    }
    if (outcome === 'INVALID') {
      throw new BadRequestException({
        message: 'Invalid OTP',
        code: 'OTP_INVALID',
        attemptsLeft,
      });
    }
    throw new BadRequestException({
      message: 'OTP expired or not requested. Please request a new one.',
      code: 'OTP_EXPIRED',
    });
  }

  /** Caps sends per IP across many phone numbers. Fails open if Redis is down. */
  private async enforceIpLimit(ip?: string): Promise<void> {
    const { ipMaxSendsPerHour } = getOtpConfig();
    const key = `otp:rate:ip:${ip ?? 'unknown'}`;

    let count: number;
    let ttlSeconds: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, IP_WINDOW_SECONDS);
      ttlSeconds = await this.redis.ttl(key);
    } catch (error) {
      this.logger.warn(
        `IP OTP rate limit skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    if (count > ipMaxSendsPerHour) {
      const retryAfter = ttlSeconds > 0 ? ttlSeconds : IP_WINDOW_SECONDS;
      throw new OtpThrottledException(
        'IP_LIMIT',
        retryAfter,
        new Date(Date.now() + retryAfter * 1000),
      );
    }
  }
}

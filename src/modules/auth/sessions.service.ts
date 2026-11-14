import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  getAccessSecret,
  getRefreshGraceMs,
  getRefreshLifetimeMs,
} from './auth.config';
import { generateRefreshToken, hashToken } from './token.util';

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

export interface SessionUser {
  id: string;
  mobileNumber: string;
  role: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
}

type IssuedTokens = SessionTokens & { tokenId: string };

type RotationOutcome =
  | { kind: 'ok'; tokens: IssuedTokens }
  | { kind: 'reuse' }
  | { kind: 'invalid' };

type Db = Prisma.TransactionClient | PrismaService;

// One message for every failure: callers must not learn *why* a token was
// rejected (unknown, expired, or stolen and replayed).
const INVALID_SESSION_MESSAGE = 'Session expired, please login again';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  /** Starts a brand-new session (= new token family) for one login/device. */
  createSession(
    user: SessionUser,
    ctx: SessionContext = {},
  ): Promise<SessionTokens> {
    return this.issueToken(this.prisma, user, randomUUID(), ctx);
  }

  /**
   * Exchanges a refresh token for a new access + refresh pair.
   *
   * Runs in one transaction holding a row lock on the presented token, so two
   * simultaneous refreshes are serialized instead of both "winning".
   */
  async rotate(
    rawRefreshToken: string,
    ctx: SessionContext = {},
  ): Promise<SessionTokens> {
    const tokenHash = hashToken(rawRefreshToken);

    const outcome = await this.prisma.$transaction(
      (tx): Promise<RotationOutcome> =>
        this.rotateInTransaction(tx, tokenHash, ctx),
    );

    // Thrown only after the transaction committed, otherwise the family
    // revocation done for reuse detection would be rolled back with it.
    if (outcome.kind !== 'ok') {
      throw new UnauthorizedException(INVALID_SESSION_MESSAGE);
    }
    return outcome.tokens;
  }

  /**
   * Ends a session. Accepts whichever credentials the client still has:
   * the refresh token, the access token's `sid` claim, or both.
   */
  async logout(rawRefreshToken?: string, accessToken?: string): Promise<void> {
    if (rawRefreshToken) {
      const existing = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(rawRefreshToken) },
        select: { familyId: true },
      });
      if (existing) await this.revokeFamily(this.prisma, existing.familyId);
    }

    if (accessToken) {
      await this.revokeAccessToken(accessToken);
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async rotateInTransaction(
    tx: Prisma.TransactionClient,
    tokenHash: string,
    ctx: SessionContext,
  ): Promise<RotationOutcome> {
    await tx.$queryRaw`SELECT "id" FROM "RefreshToken" WHERE "tokenHash" = ${tokenHash} FOR UPDATE`;

    const existing = await tx.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: { id: true, mobileNumber: true, role: true, status: true },
        },
      },
    });

    const now = new Date();
    if (!existing || existing.expiresAt <= now) return { kind: 'invalid' };
    if (existing.user.status !== 'ACTIVE') return { kind: 'invalid' };

    if (existing.revokedAt) {
      const wasJustRotated =
        existing.replacedByTokenId !== null &&
        now.getTime() - existing.revokedAt.getTime() <= getRefreshGraceMs();

      if (!wasJustRotated) {
        // An already-rotated (or logged-out) token came back late: assume it
        // leaked and kill the whole session.
        await this.revokeFamily(tx, existing.familyId);
        this.logger.warn(
          `Refresh token reuse detected, family ${existing.familyId} revoked`,
        );
        return { kind: 'reuse' };
      }

      // Grace path: a parallel tab/request already rotated this token.
      // Issue another live token in the same family and leave the winner's
      // token valid, because the browser may end up keeping either cookie.
      const tokens = await this.issueToken(
        tx,
        existing.user,
        existing.familyId,
        ctx,
      );
      return { kind: 'ok', tokens };
    }

    const tokens = await this.issueToken(
      tx,
      existing.user,
      existing.familyId,
      ctx,
    );
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: {
        revokedAt: now,
        lastUsedAt: now,
        replacedByTokenId: tokens.tokenId,
      },
    });
    return { kind: 'ok', tokens };
  }

  private async issueToken(
    db: Db,
    user: SessionUser,
    familyId: string,
    ctx: SessionContext,
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      mobileNumber: user.mobileNumber,
      role: user.role,
      sid: familyId,
    });
    const decoded = this.jwtService.decode<{ exp: number }>(accessToken);
    const refreshMaxAgeMs = getRefreshLifetimeMs();
    const rawRefreshToken = generateRefreshToken();

    const created = await db.refreshToken.create({
      select: { id: true },
      data: {
        userId: user.id,
        familyId,
        tokenHash: hashToken(rawRefreshToken),
        // Always measured from "now": this is what makes the expiry slide.
        expiresAt: new Date(Date.now() + refreshMaxAgeMs),
        userAgent: ctx.userAgent,
        ipAddress: ctx.ipAddress,
      },
    });

    return {
      tokenId: created.id,
      accessToken,
      refreshToken: rawRefreshToken,
      accessMaxAgeMs: Math.max(decoded.exp * 1000 - Date.now(), 0),
      refreshMaxAgeMs,
    };
  }

  private revokeFamily(db: Db, familyId: string) {
    return db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Blacklists the access token for its remaining life and ends its session. */
  private async revokeAccessToken(accessToken: string): Promise<void> {
    try {
      // The token may already be expired when the user clicks Logout.
      const payload = await this.jwtService.verifyAsync<{
        sid?: string;
        exp: number;
      }>(accessToken, {
        secret: getAccessSecret(),
        ignoreExpiration: true,
      });

      if (payload.sid) await this.revokeFamily(this.prisma, payload.sid);

      const secondsLeft = payload.exp - Math.floor(Date.now() / 1000);
      if (secondsLeft > 0) {
        await this.redis.set(
          `auth:blacklist:access:${accessToken}`,
          '1',
          secondsLeft,
        );
      }
    } catch (error) {
      // A malformed token or an unreachable Redis must not block logout.
      this.logger.debug(
        `Access token revocation skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

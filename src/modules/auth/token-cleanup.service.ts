import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

// Revoked rows are kept briefly so reuse detection still recognises them.
const REVOKED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async deleteStaleRefreshTokens(): Promise<number> {
    const now = new Date();
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { revokedAt: { lt: new Date(now.getTime() - REVOKED_RETENTION_MS) } },
        ],
      },
    });
    this.logger.log(`Deleted ${count} stale refresh tokens`);
    return count;
  }
}

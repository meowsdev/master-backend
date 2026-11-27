import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProviderRankingService } from './provider-ranking.service';

/** Every 15 minutes: each provider's dispatch numbers again. Kept apart so the ranking can be unit tested. */
@Injectable()
export class ProviderRankingScheduler {
  constructor(private readonly ranking: ProviderRankingService) {}

  @Cron('0 */15 * * * *')
  async tick(): Promise<void> {
    await this.ranking.handleRefreshCron();
  }
}

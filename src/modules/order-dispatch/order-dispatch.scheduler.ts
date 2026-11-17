import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderDispatchService } from './order-dispatch.service';

/** The clock behind the "no answer in 1-2 minutes, ask the next five" rule. Kept apart so the service can be unit tested. */
@Injectable()
export class OrderDispatchScheduler {
  constructor(private readonly dispatch: OrderDispatchService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async tick(): Promise<void> {
    await this.dispatch.advanceExpiredWaves();
  }
}

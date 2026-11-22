import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderExtraChargeService } from './order-extra-charge.service';

/** The clock behind "an app-less customer's extra bill is approved after 30 minutes". Kept apart so the service can be unit tested. */
@Injectable()
export class OrderExtraChargeScheduler {
  constructor(private readonly extraCharges: OrderExtraChargeService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    await this.extraCharges.autoApproveDue();
  }
}

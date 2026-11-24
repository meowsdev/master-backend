import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DueReminderService } from './due-reminder.service';

/** The clock behind the daily due reminders. Kept apart so the service can be unit tested. */
@Injectable()
export class DueReminderScheduler {
  constructor(private readonly reminders: DueReminderService) {}

  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async daily(): Promise<void> {
    await this.reminders.remindDueAutomatically();
  }
}

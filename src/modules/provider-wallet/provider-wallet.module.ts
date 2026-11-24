import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatModule } from '../chat/chat.module';
import { PaymentGateway } from '../order-completion/payment-gateway';
import { USER_EVENT_PUBLISHER } from '../order-dispatch/user-events';
import { AdminDuesController, AdminEarningsController, AdminWithdrawalsController, ProviderWalletController } from './provider-wallet.controller';
import { ProviderWalletService } from './provider-wallet.service';
import { ProviderEarningsService } from './provider-earnings.service';
import { ProviderWithdrawalService } from './provider-withdrawal.service';
import { AdminEarningsService } from './admin-earnings.service';
import { DueReminderService } from './due-reminder.service';
import { DueReminderScheduler } from './due-reminder.scheduler';

@Module({
  imports: [PrismaModule, ChatModule],
  controllers: [ProviderWalletController, AdminWithdrawalsController, AdminEarningsController, AdminDuesController],
  providers: [
    ProviderWalletService,
    ProviderEarningsService,
    ProviderWithdrawalService,
    AdminEarningsService,
    DueReminderService,
    DueReminderScheduler,
    PaymentGateway,
    // Reminders reach the provider's open app through the chat socket, like order offers.
    { provide: USER_EVENT_PUBLISHER, useExisting: ChatGateway },
  ],
})
export class ProviderWalletModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaymentGateway } from '../order-completion/payment-gateway';
import { AdminEarningsController, AdminWithdrawalsController, ProviderWalletController } from './provider-wallet.controller';
import { ProviderWalletService } from './provider-wallet.service';
import { ProviderEarningsService } from './provider-earnings.service';
import { ProviderWithdrawalService } from './provider-withdrawal.service';
import { AdminEarningsService } from './admin-earnings.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProviderWalletController, AdminWithdrawalsController, AdminEarningsController],
  providers: [ProviderWalletService, ProviderEarningsService, ProviderWithdrawalService, AdminEarningsService, PaymentGateway],
})
export class ProviderWalletModule {}

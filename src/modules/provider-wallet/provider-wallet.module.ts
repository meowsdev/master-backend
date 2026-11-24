import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaymentGateway } from '../order-completion/payment-gateway';
import { AdminWithdrawalsController, ProviderWalletController } from './provider-wallet.controller';
import { ProviderWalletService } from './provider-wallet.service';
import { ProviderEarningsService } from './provider-earnings.service';
import { ProviderWithdrawalService } from './provider-withdrawal.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProviderWalletController, AdminWithdrawalsController],
  providers: [ProviderWalletService, ProviderEarningsService, ProviderWithdrawalService, PaymentGateway],
})
export class ProviderWalletModule {}

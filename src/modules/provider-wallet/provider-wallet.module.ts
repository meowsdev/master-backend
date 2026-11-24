import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaymentGateway } from '../order-completion/payment-gateway';
import { ProviderWalletController } from './provider-wallet.controller';
import { ProviderWalletService } from './provider-wallet.service';
import { ProviderEarningsService } from './provider-earnings.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProviderWalletController],
  providers: [ProviderWalletService, ProviderEarningsService, PaymentGateway],
})
export class ProviderWalletModule {}

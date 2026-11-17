import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PaymentGateway } from '../order-completion/payment-gateway';
import { OrderAdvancePaymentController } from './order-advance-payment.controller';
import { OrderAdvancePaymentService } from './order-advance-payment.service';

@Module({
  imports: [PrismaModule],
  controllers: [OrderAdvancePaymentController],
  providers: [OrderAdvancePaymentService, PaymentGateway],
})
export class OrderAdvancePaymentModule {}

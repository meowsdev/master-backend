import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderCompletionController } from './order-completion.controller';
import { OrderCompletionService } from './order-completion.service';
import { PaymentGateway } from './payment-gateway';

@Module({
  imports: [PrismaModule],
  controllers: [OrderCompletionController],
  providers: [OrderCompletionService, PaymentGateway],
})
export class OrderCompletionModule {}

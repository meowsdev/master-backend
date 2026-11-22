import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderExtraChargeController } from './order-extra-charge.controller';
import { OrderExtraChargeScheduler } from './order-extra-charge.scheduler';
import { OrderExtraChargeService } from './order-extra-charge.service';

@Module({
  imports: [PrismaModule],
  controllers: [OrderExtraChargeController],
  providers: [OrderExtraChargeService, OrderExtraChargeScheduler],
})
export class OrderExtraChargeModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderExtraChargeController } from './order-extra-charge.controller';
import { OrderExtraChargeService } from './order-extra-charge.service';

@Module({
  imports: [PrismaModule],
  controllers: [OrderExtraChargeController],
  providers: [OrderExtraChargeService],
})
export class OrderExtraChargeModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderDispatchController } from './order-dispatch.controller';
import { OrderDispatchScheduler } from './order-dispatch.scheduler';
import { OrderDispatchService } from './order-dispatch.service';

@Module({
  imports: [PrismaModule],
  controllers: [OrderDispatchController],
  providers: [OrderDispatchService, OrderDispatchScheduler],
  exports: [OrderDispatchService],
})
export class OrderDispatchModule {}

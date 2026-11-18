import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatModule } from '../chat/chat.module';
import { OrderDispatchController } from './order-dispatch.controller';
import { OrderDispatchScheduler } from './order-dispatch.scheduler';
import { OrderDispatchService } from './order-dispatch.service';
import { USER_EVENT_PUBLISHER } from './user-events';

@Module({
  imports: [PrismaModule, ChatModule],
  controllers: [OrderDispatchController],
  providers: [OrderDispatchService, OrderDispatchScheduler, { provide: USER_EVENT_PUBLISHER, useExisting: ChatGateway }],
  exports: [OrderDispatchService],
})
export class OrderDispatchModule {}

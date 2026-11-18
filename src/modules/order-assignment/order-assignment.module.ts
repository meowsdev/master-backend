import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatModule } from '../chat/chat.module';
import { OrderDispatchModule } from '../order-dispatch/order-dispatch.module';
import { USER_EVENT_PUBLISHER } from '../order-dispatch/user-events';
import { OrderAssignmentController } from './order-assignment.controller';
import { OrderAssignmentService } from './order-assignment.service';

@Module({
  imports: [PrismaModule, ChatModule, OrderDispatchModule],
  controllers: [OrderAssignmentController],
  providers: [OrderAssignmentService, { provide: USER_EVENT_PUBLISHER, useExisting: ChatGateway }],
})
export class OrderAssignmentModule {}

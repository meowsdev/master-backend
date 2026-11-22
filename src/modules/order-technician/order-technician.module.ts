import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatModule } from '../chat/chat.module';
import { USER_EVENT_PUBLISHER } from '../order-dispatch/user-events';
import { OrderTechnicianController } from './order-technician.controller';
import { OrderTechnicianService } from './order-technician.service';

@Module({
  imports: [PrismaModule, ChatModule],
  controllers: [OrderTechnicianController],
  // The technicians' open apps hear about a new or removed job at once.
  providers: [OrderTechnicianService, { provide: USER_EVENT_PUBLISHER, useExisting: ChatGateway }],
})
export class OrderTechnicianModule {}

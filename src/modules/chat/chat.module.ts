import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatService } from './chat.service';
import { ChatBookingService } from './chat-booking.service';
import { ChatSessionService } from './chat-session.service';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../../redis/redis.module';
import { ChatGateway } from './chat.gateway';
import { ChatController } from './chat.controller';
import { OrderConversationController } from './order-conversation.controller';

@Module({
  imports: [PrismaModule, ConfigModule, JwtModule.register({}), RedisModule],
  controllers: [ChatController, OrderConversationController],
  providers: [ChatService, ChatBookingService, ChatSessionService, ChatGateway],
  exports: [ChatService, ChatBookingService, ChatSessionService, ChatGateway],
})
export class ChatModule {}

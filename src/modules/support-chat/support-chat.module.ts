import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SupportChatController } from './support-chat.controller';
import { SupportChatService } from './support-chat.service';

@Module({
  imports: [PrismaModule],
  controllers: [SupportChatController],
  providers: [SupportChatService],
})
export class SupportChatModule {}

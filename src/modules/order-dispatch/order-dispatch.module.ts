import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatModule } from '../chat/chat.module';
import { ProviderLevelingModule } from '../provider-leveling/provider-leveling.module';
import { ProviderLevelingService } from '../provider-leveling/provider-leveling.service';
import { DispatchRankingController } from './dispatch-ranking.controller';
import { OrderDispatchController } from './order-dispatch.controller';
import { OrderDispatchScheduler } from './order-dispatch.scheduler';
import { OrderDispatchService } from './order-dispatch.service';
import {
  LEVEL_METRICS,
  ProviderRankingService,
} from './provider-ranking.service';
import { ProviderRankingScheduler } from './provider-ranking.scheduler';
import { USER_EVENT_PUBLISHER } from './user-events';

@Module({
  imports: [PrismaModule, ChatModule, ProviderLevelingModule],
  controllers: [OrderDispatchController, DispatchRankingController],
  providers: [
    OrderDispatchService,
    OrderDispatchScheduler,
    ProviderRankingService,
    ProviderRankingScheduler,
    { provide: USER_EVENT_PUBLISHER, useExisting: ChatGateway },
    { provide: LEVEL_METRICS, useExisting: ProviderLevelingService },
  ],
  exports: [OrderDispatchService],
})
export class OrderDispatchModule {}

import { Module } from '@nestjs/common';
import { ProviderLevelingService } from './provider-leveling.service';
import { ProviderLevelingController } from './provider-leveling.controller';

@Module({
  controllers: [ProviderLevelingController],
  providers: [ProviderLevelingService],
  exports: [ProviderLevelingService],
})
export class ProviderLevelingModule {}

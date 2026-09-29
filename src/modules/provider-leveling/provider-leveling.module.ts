import { Module } from '@nestjs/common';
import { ProviderLevelingService } from './provider-leveling.service';
import { ProviderLevelingController } from './provider-leveling.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProviderLevelingController],
  providers: [ProviderLevelingService],
  exports: [ProviderLevelingService],
})
export class ProviderLevelingModule {}

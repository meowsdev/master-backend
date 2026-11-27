import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LocationsModule } from '../locations/locations.module';
import { ProviderKycController } from './provider-kyc.controller';
import { ProviderKycService } from './provider-kyc.service';

@Module({
  imports: [PrismaModule, LocationsModule],
  controllers: [ProviderKycController],
  providers: [ProviderKycService],
  exports: [ProviderKycService],
})
export class ProviderKycModule {}

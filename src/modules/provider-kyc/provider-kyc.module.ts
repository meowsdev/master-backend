import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LocationsModule } from '../locations/locations.module';
import { ProviderTermsModule } from '../provider-terms/provider-terms.module';
import { ProviderKycController } from './provider-kyc.controller';
import { ProviderKycService } from './provider-kyc.service';

@Module({
  imports: [PrismaModule, LocationsModule, ProviderTermsModule],
  controllers: [ProviderKycController],
  providers: [ProviderKycService],
  exports: [ProviderKycService],
})
export class ProviderKycModule {}

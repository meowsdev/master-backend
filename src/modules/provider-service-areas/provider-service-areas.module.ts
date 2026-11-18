import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LocationsModule } from '../locations/locations.module';
import { ProviderServiceAreasController } from './provider-service-areas.controller';
import { ProviderServiceAreasService } from './provider-service-areas.service';

@Module({
  imports: [PrismaModule, LocationsModule],
  controllers: [ProviderServiceAreasController],
  providers: [ProviderServiceAreasService],
})
export class ProviderServiceAreasModule {}

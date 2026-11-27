import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ProviderTermsController } from './provider-terms.controller';
import { ProviderTermsService } from './provider-terms.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProviderTermsController],
  providers: [ProviderTermsService],
  exports: [ProviderTermsService],
})
export class ProviderTermsModule {}

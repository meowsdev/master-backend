import { Module } from '@nestjs/common';
import { LegalEscalationService } from './legal-escalation.service';
import { LegalEscalationController } from './legal-escalation.controller';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LegalEscalationController],
  providers: [LegalEscalationService],
  exports: [LegalEscalationService],
})
export class LegalEscalationModule { }

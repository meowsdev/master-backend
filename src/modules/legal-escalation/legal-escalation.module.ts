import { Module } from '@nestjs/common';
import { LegalEscalationService } from './legal-escalation.service';
import { LegalEscalationController } from './legal-escalation.controller';

@Module({
  controllers: [LegalEscalationController],
  providers: [LegalEscalationService],
  exports: [LegalEscalationService],
})
export class LegalEscalationModule {}

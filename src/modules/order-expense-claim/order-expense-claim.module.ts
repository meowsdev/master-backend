import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderExpenseClaimController } from './order-expense-claim.controller';
import { OrderExpenseClaimService } from './order-expense-claim.service';

@Module({
  imports: [PrismaModule],
  controllers: [OrderExpenseClaimController],
  providers: [OrderExpenseClaimService],
})
export class OrderExpenseClaimModule {}

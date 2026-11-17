import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CustomerRatingController } from './customer-rating.controller';
import { CustomerRatingService } from './customer-rating.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustomerRatingController],
  providers: [CustomerRatingService],
})
export class CustomerRatingModule {}

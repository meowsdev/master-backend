import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderQuoteController } from './order-quote.controller';
import { OrderQuoteService } from './order-quote.service';

@Module({
  imports: [PrismaModule],
  providers: [OrderQuoteService],
  controllers: [OrderQuoteController],
})
export class OrderQuoteModule {}

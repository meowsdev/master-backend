import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OrderTechnicianController } from './order-technician.controller';
import { OrderTechnicianService } from './order-technician.service';

@Module({
  imports: [PrismaModule],
  controllers: [OrderTechnicianController],
  providers: [OrderTechnicianService],
})
export class OrderTechnicianModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LocationsModule } from '../locations/locations.module';
import { OrdersModule } from '../orders/orders.module';
import { OrderPlacementController } from './order-placement.controller';
import { OrderPlacementService } from './order-placement.service';

@Module({
  imports: [PrismaModule, OrdersModule, LocationsModule],
  controllers: [OrderPlacementController],
  providers: [OrderPlacementService],
})
export class OrderPlacementModule {}

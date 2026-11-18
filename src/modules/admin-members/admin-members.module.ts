import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LocationsModule } from '../locations/locations.module';
import { AdminMembersController } from './admin-members.controller';
import { AdminMembersService } from './admin-members.service';

@Module({
  imports: [PrismaModule, LocationsModule],
  controllers: [AdminMembersController],
  providers: [AdminMembersService],
})
export class AdminMembersModule {}

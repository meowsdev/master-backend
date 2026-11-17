import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminDirectoryController } from './admin-directory.controller';

@Module({ imports: [PrismaModule], controllers: [AdminDirectoryController] })
export class AdminDirectoryModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CatalogAdminService } from './catalog-admin.service';
import {
  CatalogAdminController,
  CatalogController,
} from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [PrismaModule],
  providers: [CatalogService, CatalogAdminService],
  controllers: [CatalogController, CatalogAdminController],
  exports: [CatalogService],
})
export class CatalogModule {}

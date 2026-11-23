import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CatalogAdminService } from './catalog-admin.service';
import { CatalogService } from './catalog.service';
import {
  CreateFaqDto,
  CreateServiceGroupDto,
  CreateVariantDto,
  ReorderDto,
  UpdateFaqDto,
  UpdateMainServiceCatalogDto,
  UpdateServiceGroupDto,
  UpdateSubServiceCatalogDto,
  UpdateVariantDto,
} from './dto/catalog-admin.dto';

/** Public: the four-level catalog the customer app browses. */
@ApiTags('Catalog')
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('groups')
  @ApiOperation({
    summary: 'Top-bar categories (AC Repair, Appliance Repair, ...)',
  })
  groups() {
    return this.catalog.listGroups();
  }

  @Get('main-services')
  @ApiOperation({
    summary: 'Main services for the chat list, optionally of one category',
  })
  mainServices(@Query('groupId') groupId?: string) {
    return this.catalog.listMainServices(groupId || undefined);
  }

  @Get('main-services/:id')
  @ApiOperation({
    summary: 'One main service with its sub-service cards (id or slug)',
  })
  mainService(@Param('id') id: string) {
    return this.catalog.getMainService(id);
  }

  @Get('main-services/:id/reviews')
  mainServiceReviews(
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    return this.catalog.getReviews({ categoryId: id }, page, 10);
  }

  @Get('sub-services/:id')
  @ApiOperation({
    summary:
      'Sub-service details: options, overview, FAQ, how to order, reviews, details',
  })
  subService(@Param('id') id: string) {
    return this.catalog.getSubService(id);
  }

  @Get('sub-services/:id/reviews')
  subServiceReviews(
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    return this.catalog.getReviews({ serviceId: id }, page, 10);
  }
}

/** Admin / manager: edit categories, options, FAQs and the new overview fields. */
@ApiTags('Catalog admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('catalog/admin')
export class CatalogAdminController {
  constructor(private readonly admin: CatalogAdminService) {}

  @Get('tree')
  tree() {
    return this.admin.tree();
  }

  @Get('ungrouped')
  ungrouped() {
    return this.admin.ungroupedMainServices();
  }

  @Post('groups')
  createGroup(@Body() dto: CreateServiceGroupDto) {
    return this.admin.createGroup(dto);
  }

  @Patch('groups/:id')
  updateGroup(@Param('id') id: string, @Body() dto: UpdateServiceGroupDto) {
    return this.admin.updateGroup(id, dto);
  }

  @Delete('groups/:id')
  deleteGroup(@Param('id') id: string) {
    return this.admin.deleteGroup(id);
  }

  @Patch('main-services/:id')
  updateMainService(
    @Param('id') id: string,
    @Body() dto: UpdateMainServiceCatalogDto,
  ) {
    return this.admin.updateMainService(id, dto);
  }

  @Patch('sub-services/:id')
  updateSubService(
    @Param('id') id: string,
    @Body() dto: UpdateSubServiceCatalogDto,
  ) {
    return this.admin.updateSubService(id, dto);
  }

  @Post('variants')
  createVariant(@Body() dto: CreateVariantDto) {
    return this.admin.createVariant(dto);
  }

  @Patch('variants/:id')
  updateVariant(@Param('id') id: string, @Body() dto: UpdateVariantDto) {
    return this.admin.updateVariant(id, dto);
  }

  @Delete('variants/:id')
  deleteVariant(@Param('id') id: string) {
    return this.admin.deleteVariant(id);
  }

  @Post('faqs')
  createFaq(@Body() dto: CreateFaqDto) {
    return this.admin.createFaq(dto);
  }

  @Patch('faqs/:id')
  updateFaq(@Param('id') id: string, @Body() dto: UpdateFaqDto) {
    return this.admin.updateFaq(id, dto);
  }

  @Delete('faqs/:id')
  deleteFaq(@Param('id') id: string) {
    return this.admin.deleteFaq(id);
  }

  @Post('reorder')
  reorder(@Body() dto: ReorderDto) {
    return this.admin.reorder(dto);
  }
}

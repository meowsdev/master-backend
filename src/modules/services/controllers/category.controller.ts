import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ServicesService } from '../services.service';
import { CreateCategoryDto, UpdateCategoryDto } from '../dto/category.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Category')
@Controller('category')
export class CategoryController {
  constructor(private readonly categoryService: ServicesService) {}

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create category (ADMIN, MANAGER only)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  createCategory(@Body() data: CreateCategoryDto, @Req() req) {
    return this.categoryService.createCategory(data);
  }

  @Get('all')
  @HttpCode(HttpStatus.OK)
  getAllCategory() {
    return this.categoryService.getAllCategory();
  }

  @Get(':identifier')
  @HttpCode(HttpStatus.OK)
  getSingleCategory(@Param('identifier') identifier: string) {
    return this.categoryService.getSingleCategory(identifier);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update category (ADMIN, MANAGER only)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  updateSingleCategory(
    @Param('id') id: string,
    @Body() data: UpdateCategoryDto,
  ) {
    return this.categoryService.updateSingleCategory(id, data);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete category (ADMIN, MANAGER only)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  deleteSingleCategory(@Param('id') id: string) {
    return this.categoryService.deleteSingleCategory(id);
  }
}

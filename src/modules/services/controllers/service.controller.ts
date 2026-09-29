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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ServicesService } from '../services.service';
import { CreateServiceDto, UpdateServiceDto } from '../dto/service.dto';
import { DiscoverProvidersQueryDto } from '../dto/discover-providers.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Service')
@Controller('service')
export class ServiceController {
  constructor(private readonly service: ServicesService) {}

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Create service (ADMIN, MANAGER only)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  createService(@Body() data: CreateServiceDto, @Req() req) {
    return this.service.createService(data);
  }

  @Get('all')
  @HttpCode(HttpStatus.OK)
  getAllServices(@Query('categoryId') categoryId?: string) {
    return this.service.getAllServices(categoryId);
  }

  @Get('providers/discover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Discover providers with GPS distance (Haversine) and rating filter',
  })
  discoverProviders(@Query() query: DiscoverProvidersQueryDto) {
    return this.service.discoverProviders(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  getSingleService(@Param('id') id: string) {
    return this.service.getSingleService(id);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update service (ADMIN, MANAGER only)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  updateSingleService(
    @Param('id') id: string,
    @Body() data: UpdateServiceDto,
  ) {
    return this.service.updateSingleService(id, data);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Delete service (ADMIN, MANAGER only)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  deleteSingleService(@Param('id') id: string) {
    return this.service.deleteSingleService(id);
  }
}

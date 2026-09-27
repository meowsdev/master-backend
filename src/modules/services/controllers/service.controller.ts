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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ServicesService } from '../services.service';
import { CreateServiceDto, UpdateServiceDto } from '../dto/service.dto';
import { DiscoverProvidersQueryDto } from '../dto/discover-providers.dto';

@ApiTags('Service')
@Controller('service')
export class ServiceController {
  constructor(private readonly service: ServicesService) { }

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  createService(@Body() data: CreateServiceDto, @Req() req) {
    return this.service.createService(data);
  }

  @Get('all')
  @HttpCode(HttpStatus.OK)
  getAllServices() {
    return this.service.getAllServices();
  }

  @Get('providers/discover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Discover providers with GPS distance (Haversine) and rating filter' })
  discoverProviders(@Query() query: DiscoverProvidersQueryDto) {
    return this.service.discoverProviders(query);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  getSingleService(@Param('id') id: string) {
    return this.service.getSingleService(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  updateSingleService(@Param('id') id: string, @Body() data: UpdateServiceDto) {
    return this.service.updateSingleService(id, data);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  deleteSingleService(@Param('id') id: string) {
    return this.service.deleteSingleService(id);
  }
}

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LocationsService } from './locations.service';

@ApiTags('Locations')
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('districts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'All districts (public, used by the sign-up form)' })
  getDistricts() {
    return this.locations.getDistricts();
  }

  @Get('districts/:districtId/upazilas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upazilas of one district (public)' })
  getUpazilas(@Param('districtId', ParseIntPipe) districtId: number) {
    const upazilas = this.locations.getUpazilas(districtId);
    if (upazilas.length === 0) throw new NotFoundException('District not found');
    return upazilas;
  }
}

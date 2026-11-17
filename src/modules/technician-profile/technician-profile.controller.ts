import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TECHNICIAN_MANAGER_ROLES } from '../auth/role-policy';
import {
  AdminCreateTechnicianDto,
  AssignTechnicianAgencyDto,
  UpdateMyTechnicianLocationDto,
} from './dto/technician-profile.dto';
import { TechnicianProfileService } from './technician-profile.service';

type AuthenticatedRequest = Request & { user: { id: string } };

@ApiTags('Technician Profile')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('technician-profile')
export class TechnicianProfileController {
  constructor(
    private readonly technicianProfileService: TechnicianProfileService,
  ) {}

  // ---- Admin only: creating technicians and attaching them to providers ----

  @Get()
  @Roles(...TECHNICIAN_MANAGER_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ADMIN: list all technicians with their provider' })
  list() {
    return this.technicianProfileService.listForAdmin();
  }

  @Post()
  @Roles(...TECHNICIAN_MANAGER_ROLES)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ADMIN: create a technician account' })
  create(@Body() data: AdminCreateTechnicianDto) {
    return this.technicianProfileService.createByAdmin(data);
  }

  @Patch(':id/agency')
  @Roles(...TECHNICIAN_MANAGER_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ADMIN: attach a technician to a provider (or detach with null)' })
  assignAgency(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() data: AssignTechnicianAgencyDto,
  ) {
    return this.technicianProfileService.assignAgency(id, data.providerAgencyId);
  }

  @Delete(':id')
  @Roles(...TECHNICIAN_MANAGER_ROLES)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ADMIN: delete a technician profile' })
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.technicianProfileService.removeByAdmin(id);
  }

  // ---- A technician looking at / updating themselves ----

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get my technician profile' })
  findMine(@Req() req: AuthenticatedRequest) {
    return this.technicianProfileService.findMine(req.user.id);
  }

  @Patch('me/location')
  @Roles(UserRole.TECHNICIAN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'TECHNICIAN: update my current location (the only self-service change)' })
  updateMyLocation(
    @Req() req: AuthenticatedRequest,
    @Body() data: UpdateMyTechnicianLocationDto,
  ) {
    return this.technicianProfileService.updateMyLocation(req.user.id, data);
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get technician profile by id' })
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.technicianProfileService.findOne(id);
  }
}

import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminStaffService } from './admin-staff.service';
import { CreateStaffDto, UpdateStaffDto } from './dto/admin-staff.dto';

/** Admin only: a manager or anyone else could otherwise give themselves (or a friend) a higher position. */
@ApiTags('Admin staff')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/staff')
export class AdminStaffController {
  constructor(private readonly staff: AdminStaffService) {}

  @Get()
  @ApiOperation({ summary: 'Office staff and admins' })
  list() {
    return this.staff.list();
  }

  @Post()
  @ApiOperation({ summary: 'Add a Manager, Support, HR or Counselor by phone number' })
  create(@Body() dto: CreateStaffDto) {
    return this.staff.create(dto);
  }

  @Patch(':staffId')
  @ApiOperation({ summary: "Change a staff member's position, or turn the account off / on" })
  update(@Param('staffId', new ParseUUIDPipe()) staffId: string, @Body() dto: UpdateStaffDto, @Req() req: { user: { id: string } }) {
    return this.staff.update(staffId, dto, req.user);
  }
}

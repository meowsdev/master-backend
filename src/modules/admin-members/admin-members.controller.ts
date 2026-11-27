import {
  Body,
  Controller,
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
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminMembersService } from './admin-members.service';
import { CreateMemberDto } from './dto/create-member.dto';
import { ModerateMemberDto } from './dto/moderate-member.dto';
import {
  SetCommissionDto,
  SetOwnOrderChargeDto,
} from './dto/set-commission.dto';

@ApiTags('Admin members')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('admin/members')
export class AdminMembersController {
  constructor(private readonly members: AdminMembersService) {}

  @Post()
  @ApiOperation({ summary: 'Add a provider or a customer by phone number' })
  create(@Body() dto: CreateMemberDto) {
    return this.members.create(dto);
  }

  @Get(':memberId')
  @ApiOperation({
    summary: 'Full details of a provider, technician or customer',
  })
  details(@Param('memberId', new ParseUUIDPipe()) memberId: string) {
    return this.members.getDetails(memberId);
  }

  @Patch(':memberId/commission')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: "Set a provider's own commission percent (admin only)",
  })
  setCommission(
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() dto: SetCommissionDto,
  ) {
    return this.members.setCommission(memberId, dto.commissionRate);
  }

  @Patch(':memberId/own-order-charge')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary:
      "Set a provider's charge on orders they create themselves; null follows the global rule (admin only)",
  })
  setOwnOrderCharge(
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() dto: SetOwnOrderChargeDto,
  ) {
    return this.members.setOwnOrderCharge(memberId, dto.rate);
  }

  @Post(':memberId/moderation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restrict, block or ban a member, or lift it' })
  moderate(
    @Req() req: { user: { id: string; role: string } },
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Body() dto: ModerateMemberDto,
  ) {
    return this.members.moderate(req.user, memberId, dto.action, dto.reason);
  }
}

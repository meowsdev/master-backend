import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ProviderOrderChargeDto } from './dto/provider-order-charge.dto';
import { PlatformSettingsService } from './platform-settings.service';

@ApiTags('Platform settings')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/platform-settings')
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get('provider-order-charge')
  @ApiOperation({
    summary:
      'ADMIN: the charge on orders providers create for their own customers',
  })
  getProviderOrderCharge() {
    return this.settings.getProviderOrderCharge();
  }

  @Patch('provider-order-charge')
  @ApiOperation({
    summary:
      'ADMIN: turn that charge on or off and set its percent (new orders only)',
  })
  setProviderOrderCharge(
    @Body() dto: ProviderOrderChargeDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.settings.setProviderOrderCharge(dto, req.user.id);
  }
}

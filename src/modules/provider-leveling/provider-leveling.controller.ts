import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProviderLevelingService } from './provider-leveling.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Provider Leveling')
@Controller('provider-leveling')
export class ProviderLevelingController {
  constructor(
    private readonly providerLevelingService: ProviderLevelingService,
  ) {}

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Manually trigger monthly provider leveling evaluation (Admin/Manager)',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('trigger')
  triggerLeveling() {
    return this.providerLevelingService.runLevelingProcess();
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: "The signed-in provider's level, progress and what the next level needs" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PROVIDER)
  @Get('me')
  myLevel(@Req() req: { user: { id: string } }) {
    return this.providerLevelingService.getMyLevel(req.user.id);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Get provider level distribution and statistics',
  })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.HR)
  @Get('stats')
  getLevelDistribution() {
    return this.providerLevelingService.getLevelDistribution();
  }
}

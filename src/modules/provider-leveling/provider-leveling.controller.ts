import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProviderLevelingService } from './provider-leveling.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { SetManyProvidersLevelDto, SetMetricTargetsDto, SetProviderLevelDto } from './dto/level-admin.dto';

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
  @ApiOperation({ summary: 'Every provider with their level, for the Levels tab (Admin/Manager)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('providers')
  listProviders() {
    return this.providerLevelingService.listProviders();
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Give many providers the same level at once; locked, the monthly evaluation leaves them (Admin)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('providers/level')
  setLevelForMany(@Body() dto: SetManyProvidersLevelDto) {
    return this.providerLevelingService.setLevelForMany(dto.userIds, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: "Each level's six targets (Admin/Manager)" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('targets')
  getTargets() {
    return this.providerLevelingService.targets();
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: "A provider's Level page, as they see it (staff with member details: Admin/Manager)" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get('providers/:userId')
  providerLevel(@Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.providerLevelingService.getProviderLevel(userId);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: "Give a provider a level by hand; locked, the monthly evaluation leaves it (Admin)" })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('providers/:userId/level')
  setProviderLevel(@Param('userId', new ParseUUIDPipe()) userId: string, @Body() dto: SetProviderLevelDto) {
    return this.providerLevelingService.setProviderLevel(userId, dto);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Change what one metric needs at Level 1, Level 2 and Top Rated (Admin)' })
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put('targets')
  setTargets(@Body() dto: SetMetricTargetsDto, @Req() req: { user: { id: string } }) {
    return this.providerLevelingService.setMetricTargets(dto.metric, { LEVEL_1: dto.LEVEL_1, LEVEL_2: dto.LEVEL_2, TOP_RATED: dto.TOP_RATED }, req.user.id);
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

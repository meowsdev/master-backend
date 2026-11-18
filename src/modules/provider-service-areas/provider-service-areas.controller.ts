import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SetServiceAreasDto } from './dto/set-service-areas.dto';
import { ProviderServiceAreasService } from './provider-service-areas.service';

@ApiTags('Provider service areas')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PROVIDER)
@Controller('providers/me/service-areas')
export class ProviderServiceAreasController {
  constructor(private readonly areas: ProviderServiceAreasService) {}

  @Get()
  @ApiOperation({ summary: 'The upazilas I take orders in' })
  list(@Req() req: { user: { id: string } }) {
    return this.areas.list(req.user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Replace the upazilas I take orders in' })
  replace(@Req() req: { user: { id: string } }, @Body() dto: SetServiceAreasDto) {
    return this.areas.replace(req.user.id, dto.areas);
  }
}

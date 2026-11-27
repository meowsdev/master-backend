import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  PreviewDispatchDto,
  UpdateDispatchSettingsDto,
} from './dto/dispatch-ranking.dto';
import { OrderDispatchService } from './order-dispatch.service';
import { ProviderRankingService } from './provider-ranking.service';
import { RANKING_PRESETS } from './ranking-rules';

@ApiTags('Dispatch ranking')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/dispatch-ranking')
export class DispatchRankingController {
  constructor(
    private readonly ranking: ProviderRankingService,
    private readonly dispatch: OrderDispatchService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'ADMIN: whether new orders go to providers by dispatch score, the weights, and the presets',
  })
  async get() {
    return { ...(await this.ranking.getSettings()), presets: RANKING_PRESETS };
  }

  @Put()
  @ApiOperation({
    summary:
      'ADMIN: turn the dispatch ranking on or off and set the weights (next waves use them)',
  })
  update(
    @Body() dto: UpdateDispatchSettingsDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.ranking.updateSettings(dto, req.user.id);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'ADMIN: who would be asked first for a service and place, with weights being tried',
  })
  preview(@Body() dto: PreviewDispatchDto) {
    const location =
      dto.districtId && dto.upazilaId
        ? { districtId: dto.districtId, upazilaId: dto.upazilaId }
        : null;
    return this.dispatch.previewRanking({
      serviceId: dto.serviceId,
      location,
      weights: dto.weights,
    });
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "ADMIN: work out every provider's dispatch numbers now (otherwise every 15 minutes)",
  })
  refresh() {
    return this.ranking.refreshAllStats();
  }
}

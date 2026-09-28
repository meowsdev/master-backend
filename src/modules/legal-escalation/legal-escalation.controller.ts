import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LegalEscalationService } from './legal-escalation.service';
import { CreateLegalEscalationDto } from './dto/create-legal-escalation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Legal Escalation')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('legal-escalation')
export class LegalEscalationController {
  constructor(
    private readonly legalEscalationService: LegalEscalationService,
  ) {}

  @ApiOperation({
    summary: 'Escalate order to legal, lock provider/order, and close sessions (Admin/Support/Manager)',
  })
  @Roles(UserRole.ADMIN, UserRole.SUPPORT, UserRole.MANAGER)
  @Post('orders/:orderId/escalate')
  escalateOrder(
    @Param('orderId') orderId: string,
    @Body() dto: CreateLegalEscalationDto,
    @Req() req: any,
  ) {
    return this.legalEscalationService.escalateOrder(
      orderId,
      dto,
      req.user?.id,
    );
  }

  @ApiOperation({
    summary: 'Get legal dossier and printable HTML report for an order (Admin/Support/Manager)',
  })
  @Roles(UserRole.ADMIN, UserRole.SUPPORT, UserRole.MANAGER)
  @Get('reports/:orderId')
  getLegalReport(@Param('orderId') orderId: string) {
    return this.legalEscalationService.generateLegalReport(orderId);
  }

  @ApiOperation({
    summary: 'List all escalated DISPUTED legal cases (Admin/Support/Manager)',
  })
  @Roles(UserRole.ADMIN, UserRole.SUPPORT, UserRole.MANAGER)
  @Get('cases')
  getEscalatedCases() {
    return this.legalEscalationService.getEscalatedCases();
  }
}

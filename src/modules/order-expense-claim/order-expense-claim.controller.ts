import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApproveExpenseClaimDto, RejectExpenseClaimDto, SubmitExpenseClaimDto } from './dto/expense-claim.dto';
import { OrderExpenseClaimService } from './order-expense-claim.service';

interface AuthenticatedRequest {
  user: { id: string; role: UserRole };
}

@ApiTags('Order Expense Claims')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrderExpenseClaimController {
  constructor(private readonly claims: OrderExpenseClaimService) {}

  @Post(':orderId/expense-claims')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Provider / technician sends the parts and costs of a finished job for admin review' })
  submit(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: SubmitExpenseClaimDto, @Req() req: AuthenticatedRequest) {
    return this.claims.submit(orderId, dto, req.user);
  }

  @Get(':orderId/expense-claims')
  @ApiOperation({ summary: "An order's cost claims (its provider / technician and staff)" })
  list(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Req() req: AuthenticatedRequest) {
    return this.claims.list(orderId, req.user);
  }

  @Patch('expense-claims/:claimId/approve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin approves with reviewed amounts; commission is worked out on (total - costs)' })
  approve(@Param('claimId', new ParseUUIDPipe()) claimId: string, @Body() dto: ApproveExpenseClaimDto, @Req() req: AuthenticatedRequest) {
    return this.claims.approve(claimId, dto, req.user);
  }

  @Patch('expense-claims/:claimId/reject')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin rejects; the provider may send corrected costs' })
  reject(@Param('claimId', new ParseUUIDPipe()) claimId: string, @Body() dto: RejectExpenseClaimDto, @Req() req: AuthenticatedRequest) {
    return this.claims.reject(claimId, dto.note, req.user);
  }
}

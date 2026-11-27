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

  @Get(':orderId/expense-claims/status')
  @ApiOperation({ summary: 'Whether costs can be sent now (once per billing: the job, then each revision that billed extra work)' })
  status(@Param('orderId', new ParseUUIDPipe()) orderId: string, @Req() req: AuthenticatedRequest) {
    return this.claims.status(orderId, req.user);
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
  @ApiOperation({ summary: 'Admin sends it back to the provider, with a note and optionally the amounts they think are right' })
  reject(@Param('claimId', new ParseUUIDPipe()) claimId: string, @Body() dto: RejectExpenseClaimDto, @Req() req: AuthenticatedRequest) {
    return this.claims.reject(claimId, dto, req.user);
  }

  @Patch('expense-claims/:claimId/provider-accept')
  @Roles(UserRole.PROVIDER)
  @ApiOperation({ summary: 'Provider accepts the costs (amounts may change) and sends them to an admin' })
  providerAccept(@Param('claimId', new ParseUUIDPipe()) claimId: string, @Body() dto: ApproveExpenseClaimDto, @Req() req: AuthenticatedRequest) {
    return this.claims.providerAccept(claimId, dto, req.user);
  }

  @Patch('expense-claims/:claimId/provider-return')
  @Roles(UserRole.PROVIDER)
  @ApiOperation({ summary: "Provider sends the technician's costs back to them with a note" })
  providerReturn(@Param('claimId', new ParseUUIDPipe()) claimId: string, @Body() dto: RejectExpenseClaimDto, @Req() req: AuthenticatedRequest) {
    return this.claims.providerReturn(claimId, dto.note, req.user);
  }

  @Patch('expense-claims/:claimId/resubmit')
  @Roles(UserRole.TECHNICIAN)
  @ApiOperation({ summary: 'Technician changes the costs the provider sent back and sends them again' })
  resubmit(@Param('claimId', new ParseUUIDPipe()) claimId: string, @Body() dto: SubmitExpenseClaimDto, @Req() req: AuthenticatedRequest) {
    return this.claims.resubmit(claimId, dto, req.user);
  }
}

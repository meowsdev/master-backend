import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PayDueDto } from './dto/pay-due.dto';
import { ProviderWalletService } from './provider-wallet.service';
import { ProviderEarningsService } from './provider-earnings.service';
import { ProviderWithdrawalService } from './provider-withdrawal.service';
import { AdminEarningsService } from './admin-earnings.service';
import { ListWithdrawalsQuery, MarkWithdrawalPaidDto, RejectWithdrawalDto, RequestWithdrawalDto } from './dto/withdrawal.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

interface AuthenticatedRequest {
  user: { id: string; role: UserRole };
}

@ApiTags('Provider Wallet')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('provider-wallet')
export class ProviderWalletController {
  constructor(
    private readonly wallet: ProviderWalletService,
    private readonly earningsService: ProviderEarningsService,
    private readonly withdrawals: ProviderWithdrawalService,
  ) {}

  @Get('me/earnings')
  @UseGuards(RolesGuard)
  @Roles(UserRole.PROVIDER)
  @ApiOperation({ summary: "The signed-in provider's earnings: totals, last 6 months and recent completed jobs" })
  earnings(@Req() req: AuthenticatedRequest) {
    return this.earningsService.earnings(req.user.id);
  }

  @Get('me')
  @ApiOperation({ summary: "The signed-in provider's wallet and what they owe the platform" })
  summary(@Req() req: AuthenticatedRequest) {
    return this.wallet.summary(req.user.id);
  }

  @Post('me/pay-due')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pay the whole outstanding due online' })
  payDue(@Body() dto: PayDueDto, @Req() req: AuthenticatedRequest) {
    return this.wallet.payDue(req.user.id, dto.method);
  }

  @Get('me/withdrawals')
  @UseGuards(RolesGuard)
  @Roles(UserRole.PROVIDER)
  @ApiOperation({ summary: "The signed-in provider's withdrawal requests, newest first" })
  myWithdrawals(@Req() req: AuthenticatedRequest) {
    return this.withdrawals.listMine(req.user.id);
  }

  @Post('me/withdrawals')
  @UseGuards(RolesGuard)
  @Roles(UserRole.PROVIDER)
  @ApiOperation({ summary: 'Ask for wallet money to be sent to bKash, Nagad or a bank account; the amount is held at once' })
  requestWithdrawal(@Body() dto: RequestWithdrawalDto, @Req() req: AuthenticatedRequest) {
    return this.withdrawals.request(req.user.id, dto);
  }

  @Post('me/withdrawals/:withdrawalId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(UserRole.PROVIDER)
  @ApiOperation({ summary: 'Take back a pending withdrawal; the amount returns to the wallet' })
  cancelWithdrawal(@Param('withdrawalId', new ParseUUIDPipe()) withdrawalId: string, @Req() req: AuthenticatedRequest) {
    return this.withdrawals.cancel(req.user.id, withdrawalId);
  }
}

/** Admin: the platform's earnings (commission), what partners owe and what is owed to them. */
@ApiTags('Admin earnings')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/earnings')
export class AdminEarningsController {
  constructor(private readonly earnings: AdminEarningsService) {}

  @Get()
  @ApiOperation({ summary: 'Platform commission totals, last 6 months, per partner, and the partner wallets' })
  report() {
    return this.earnings.report();
  }
}

/** Admin: provider withdrawal requests. The money is sent outside the app; here it is marked paid or rejected. */
@ApiTags('Admin withdrawals')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/withdrawals')
export class AdminWithdrawalsController {
  constructor(private readonly withdrawals: ProviderWithdrawalService) {}

  @Get()
  @ApiOperation({ summary: 'Withdrawal requests (pending ones oldest first)' })
  list(@Query() query: ListWithdrawalsQuery) {
    return this.withdrawals.listAll(query.status);
  }

  @Post(':withdrawalId/paid')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a withdrawal paid with the transaction id it was sent with' })
  markPaid(@Param('withdrawalId', new ParseUUIDPipe()) withdrawalId: string, @Body() dto: MarkWithdrawalPaidDto, @Req() req: AuthenticatedRequest) {
    return this.withdrawals.markPaid(withdrawalId, req.user.id, dto.transactionRef, dto.note);
  }

  @Post(':withdrawalId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a withdrawal; the amount returns to the wallet' })
  reject(@Param('withdrawalId', new ParseUUIDPipe()) withdrawalId: string, @Body() dto: RejectWithdrawalDto, @Req() req: AuthenticatedRequest) {
    return this.withdrawals.reject(withdrawalId, req.user.id, dto.reason);
  }
}

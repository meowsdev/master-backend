import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PayDueDto } from './dto/pay-due.dto';
import { ProviderWalletService } from './provider-wallet.service';

interface AuthenticatedRequest {
  user: { id: string; role: UserRole };
}

@ApiTags('Provider Wallet')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('provider-wallet')
export class ProviderWalletController {
  constructor(private readonly wallet: ProviderWalletService) {}

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
}

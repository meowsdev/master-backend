import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminDirectoryController {
  constructor(private readonly prisma: PrismaService) {}

  /** Every provider with their standing: level, rating, what they owe, KYC state. Read-only. */
  @Get('providers')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ADMIN: list providers with level, rating, wallet and KYC status' })
  async providers() {
    const providers = await this.prisma.providerProfile.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        companyName: true,
        rating: true,
        level: true,
        totalCompletedOrders: true,
        isAvailable: true,
        walletBalance: true,
        isBlockedForNegative: true,
        kyc: { select: { status: true } },
        user: { select: { id: true, name: true, username: true, mobileNumber: true, status: true, profilePhoto: true } },
        _count: { select: { orders: true } },
      },
    });
    return providers.map(({ walletBalance, ...provider }) => ({
      ...provider,
      // A negative wallet is what the provider owes the platform.
      dueAmount: Number(walletBalance) < 0 ? -Number(walletBalance) : 0,
    }));
  }
}

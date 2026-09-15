import {
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type * as express from 'express';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import {
  CompleteProfileDto,
  SwitchProfileDto,
} from './dto/complete-profile.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Request Otp Via Phone Number' })
  @Post('request-otp')
  requestOtp(@Body() data: RequestOtpDto, @Req() req: express.Request) {
    const ip = req.ip;
    return this.authService.requestOtp(data, ip);
  }

  @Post('verify-otp')
  verifyOtp(@Body() data: VerifyOtpDto) {
    return this.authService.verifyOtp(data);
  }

  @Post('refresh')
  refresh(@Body() data: RefreshTokenDto, @Req() req: express.Request) {
    return this.authService.refreshToken(data.refreshToken, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }

  @Post('logout')
  logout(
    @Body() data: RefreshTokenDto,
    @Headers('authorization') authorization?: string,
  ) {
    const accessToken = authorization?.replace(/^Bearer\s+/i, '').trim();
    return this.authService.logout(data.refreshToken, accessToken);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get logged in user with profile IDs' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.authService.getMe(req.user.id);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Complete profile and create role profile',
    description:
      'Send email, fullName, and role. If role is CUSTOMER, PROVIDER, or COUNSELOR, the matching profile is created automatically.',
  })
  @UseGuards(JwtAuthGuard)
  @Patch('complete-profile')
  completeProfile(@Body() data: CompleteProfileDto, @Req() req: any) {
    return this.authService.completeProfile(req.user.id, data);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Switch current active profile',
    description:
      'Use this when one mobile number has multiple profiles. It creates the selected profile if missing and returns activeProfile.',
  })
  @UseGuards(JwtAuthGuard)
  @Post('switch-profile')
  switchProfile(@Body() data: SwitchProfileDto, @Req() req: any) {
    return this.authService.switchProfile(req.user.id, data.role);
  }
}

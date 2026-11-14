import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type * as express from 'express';
import { AuthService } from './auth.service';
import { OtpThrottledFilter } from './otp-throttled.exception';
import { SessionsService } from './sessions.service';
import {
  clearAuthCookies,
  extractAccessToken,
  readCookie,
  REFRESH_COOKIE,
  setAuthCookies,
} from './auth-cookies.util';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import {
  CompleteProfileDto,
  SwitchProfileDto,
} from './dto/complete-profile.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { TechnicianLoginDto } from './dto/technician-login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @ApiOperation({ summary: 'Request Otp Via Phone Number' })
  @UseFilters(OtpThrottledFilter)
  @Post('request-otp')
  requestOtp(@Body() data: RequestOtpDto, @Req() req: express.Request) {
    const ip = req.ip;
    return this.authService.requestOtp(data, ip);
  }

  @ApiOperation({
    summary: 'Verify OTP and start a cookie session',
    description:
      'Sets httpOnly access_token and refresh_token cookies; tokens are not returned in the body.',
  })
  @Post('verify-otp')
  async verifyOtp(
    @Body() data: VerifyOtpDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const { user, tokens } = await this.authService.verifyOtp(data, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setAuthCookies(res, tokens);
    return { user };
  }

  @ApiOperation({ summary: 'Technician direct password login' })
  @Post('technician-login')
  technicianLogin(
    @Body() data: TechnicianLoginDto,
    @Req() req: express.Request,
  ) {
    return this.authService.technicianLogin(data, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }

  @ApiOperation({
    summary: 'Rotate the refresh token and issue a new token pair',
    description:
      'Reads the refresh_token cookie (or a legacy body token). Every call returns a new access and refresh token, each valid for a fresh full lifetime.',
  })
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Body() data: RefreshTokenDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const cookieToken = readCookie(req, REFRESH_COOKIE);
    const presentedToken = cookieToken ?? data.refreshToken;
    if (!presentedToken) {
      throw new UnauthorizedException('Session expired, please login again');
    }

    const tokens = await this.sessions.rotate(presentedToken, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    if (cookieToken) {
      setAuthCookies(res, tokens);
      return { message: 'Session refreshed' };
    }
    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  @ApiOperation({
    summary: 'Log out of the current session',
    description:
      'The only way a session normally ends. Works with an expired access token and always clears both cookies.',
  })
  @HttpCode(200)
  @Post('logout')
  async logout(
    @Body() data: RefreshTokenDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.sessions.logout(
      readCookie(req, REFRESH_COOKIE) ?? data.refreshToken,
      extractAccessToken(req),
    );
    clearAuthCookies(res);
    return { message: 'Logged Out Successfully' };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Log out of every device' })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('logout-all')
  async logoutAll(
    @Req() req: { user: { id: string } },
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.sessions.revokeAllForUser(req.user.id);
    clearAuthCookies(res);
    return { message: 'Logged out of all sessions' };
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get logged in user with profile IDs' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: { user: { id: string } }) {
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
  completeProfile(
    @Body() data: CompleteProfileDto,
    @Req() req: { user: { id: string } },
  ) {
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
  switchProfile(
    @Body() data: SwitchProfileDto,
    @Req() req: { user: { id: string } },
  ) {
    return this.authService.switchProfile(req.user.id, data.role);
  }

  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Recharge provider wallet balance' })
  @UseGuards(JwtAuthGuard)
  @Post('provider/recharge-wallet')
  rechargeProviderWallet(
    @Req() req: { user: { id: string } },
    @Body('amount') amount: number,
  ) {
    return this.authService.rechargeProviderWallet(req.user.id, Number(amount));
  }
}

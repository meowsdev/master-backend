import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import {
  generateOtpCode,
  hashOtpCode,
  MAX_REQUESTS_PER_WINDOW,
  MAX_VERIFY_ATTEMPTS,
  OTP_EXPIRY_MINUTES,
  REQUEST_WINDOW_MINUTES,
} from './otp.util';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { RedisService } from '../../redis/redis.service';
import { UserRole } from '@prisma/client';

import {
  ACCESS_TOKEN_EXPIRY,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  generateRefreshToken,
  hashToken,
  REFRESH_TOKEN_EXPIRY_DAYS,
} from './token.util';

const USER_SELECT = {
  id: true,
  mobileNumber: true,
  email: true,
  name: true,
  profilePhoto: true,
  role: true,
  status: true,
  isVerified: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  private async checkOtpRateLimit(key: string) {
    const count = await this.redisService.incr(key);

    if (count === 1) {
      await this.redisService.expire(key, REQUEST_WINDOW_MINUTES * 60);
    }

    if (count > MAX_REQUESTS_PER_WINDOW) {
      throw new HttpException(
        `Too many requests. Please try again after ${REQUEST_WINDOW_MINUTES} minutes`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async requestOtp(data: RequestOtpDto, ip?: string) {
    const phoneRateKey = `otp:rate:phone:${data.phoneNumber}`;
    const ipRateKey = `otp:rate:ip:${ip ?? 'unknown'}`;

    await this.checkOtpRateLimit(phoneRateKey);
    await this.checkOtpRateLimit(ipRateKey);

    const code = generateOtpCode();
    const otpKey = `otp:${data.phoneNumber}`;

    await this.redisService.set(
      otpKey,
      hashOtpCode(code),
      OTP_EXPIRY_MINUTES * 60,
    );

    console.log(`OTP for ${data.phoneNumber}: ${code}`);

    return {
      message: 'OTP sent successfully',
      phoneNumber: data.phoneNumber,
      expiresInSeconds: OTP_EXPIRY_MINUTES * 60,
      code,
    };
  }

  async verifyOtp(data: VerifyOtpDto) {
    const otpKey = `otp:${data.phoneNumber}`;
    const attemptKey = `otp:attempts:${data.phoneNumber}`;
    const savedOtp = await this.redisService.get(otpKey);

    if (!savedOtp) {
      throw new BadRequestException(
        'OTP expired or not requested. Please request a new one.',
      );
    }

    const isMatch = savedOtp === hashOtpCode(data.code);
    if (!isMatch) {
      const attempts = await this.redisService.incr(attemptKey);

      if (attempts === 1) {
        await this.redisService.expire(attemptKey, OTP_EXPIRY_MINUTES * 60);
      }

      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await this.redisService.del(otpKey);
        await this.redisService.del(attemptKey);
        throw new BadRequestException(
          'Too many incorrect attempts. Please request a new OTP.',
        );
      }

      throw new BadRequestException('Invalid OTP');
    }

    await this.redisService.del(otpKey);
    await this.redisService.del(attemptKey);

    const user = await this.prisma.user.upsert({
      where: {
        mobileNumber: data.phoneNumber,
      },
      update: {
        isVerified: true,
        status: 'ACTIVE',
      },
      create: {
        mobileNumber: data.phoneNumber,
        isVerified: true,
        status: 'ACTIVE',
      },
      select: USER_SELECT,
    });

    // const accessToken = await this.jwtService.signAsync({
    //   sub: user.id,
    //   mobileNumber: user.mobileNumber,
    //   role: user.role,
    // });
    const tokens = await this.issueTokenPair(user);
    return {
      user,
      ...tokens,
    };
  }

  async completeProfile(userid: string, data: CompleteProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userid,
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (data.email && data.email !== user.email) {
      const isEmailExisit = await this.prisma.user.findUnique({
        where: {
          email: data.email,
        },
      });

      if (isEmailExisit) {
        throw new BadRequestException('Email already exists');
      }
    }

    const role = data.role || user.role;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: {
          id: userid,
        },
        data: {
          name: data.fullName || user.name,
          email: data.email || user.email,
          role,
        },
      });
      await this.ensureProfile(tx, userid, role);
    });

    return this.getMe(userid);
  }

  async switchProfile(userId: string, role: UserRole) {
    const profileRoles: UserRole[] = [
      UserRole.CUSTOMER,
      UserRole.PROVIDER,
      UserRole.COUNSELOR,
    ];

    if (!profileRoles.includes(role)) {
      throw new BadRequestException('This role cannot be used as a profile');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { role },
      });

      await this.ensureProfile(tx, userId, role);
    });

    return this.getMe(userId);
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        ...USER_SELECT,
        customerProfile: {
          select: {
            id: true,
            address: true,
            gender: true,
            dateOfBirth: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        providerProfile: {
          select: {
            id: true,
            bio: true,
            experienceYears: true,
            isAvailable: true,
            rating: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        counselorProfile: {
          select: {
            id: true,
            activeChatCount: true,
            isOnline: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) return null;

    return {
      ...user,
      activeProfile: this.getActiveProfile(user),
    };
  }

  private getActiveProfile(user: {
    role: UserRole;
    customerProfile: unknown;
    providerProfile: unknown;
    counselorProfile: unknown;
  }) {
    if (user.role === UserRole.CUSTOMER) return user.customerProfile;
    if (user.role === UserRole.PROVIDER) return user.providerProfile;
    if (user.role === UserRole.COUNSELOR) return user.counselorProfile;
    return null;
  }

  private async ensureProfile(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    userId: string,
    role: UserRole,
  ) {
    if (role === UserRole.CUSTOMER) {
      await tx.customerProfile.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });
    }

    if (role === UserRole.PROVIDER) {
      await tx.providerProfile.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });
    }

    if (role === UserRole.COUNSELOR) {
      await tx.counselorProfile.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });
    }
  }

  private async issueTokenPair(
    user: { id: string; mobileNumber: string; role: string },
    ctx: { userAgent?: string; ipAddress?: string } = {},
  ) {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      mobileNumber: user.mobileNumber,
      role: user.role,
    });

    const rawRefreshToken = generateRefreshToken();

    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawRefreshToken),
        expiresAt,
        userAgent: ctx.userAgent,
        ipAddress: ctx.ipAddress,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }
  async refreshToken(
    rawToken: string,
    ctx: { userAgent?: string; ipAddress?: string } = {},
  ) {
    const tokenHash = hashToken(rawToken);

    const existing = await this.prisma.refreshToken.findUnique({
      where: {
        tokenHash,
      },
      include: {
        user: true,
      },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid Refresh Token');
    }

    if (existing.revokedAt) {
      await this.revokeAllRefreshTokens(existing.userId);
      throw new UnauthorizedException(
        'Token reuse detected, all sessions revoked. Please login again.',
      );
    }

    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException(
        'Refresh token expired, please login again',
      );
    }

    await this.prisma.refreshToken.update({
      where: {
        id: existing.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return this.issueTokenPair(
      {
        id: existing.user.id,
        mobileNumber: existing.user.mobileNumber,
        role: existing.user.role,
      },
      ctx,
    );
  }

  async logout(rawToken: string, accessToken?: string) {
    const tokenHash = hashToken(rawToken);

    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    if (accessToken) {
      await this.redisService.set(
        `auth:blacklist:access:${accessToken}`,
        '1',
        ACCESS_TOKEN_EXPIRY_SECONDS,
      );
    }

    return {
      message: 'Logged Out Successfully',
    };
  }

  private async revokeAllRefreshTokens(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}

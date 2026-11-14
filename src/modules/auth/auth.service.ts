import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { OtpService } from './otp.service';
import { getOtpConfig } from './otp.config';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { TechnicianLoginDto } from './dto/technician-login.dto';
import { UserRole } from '@prisma/client';
import { SessionContext, SessionsService } from './sessions.service';

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
    private readonly sessions: SessionsService,
    private readonly otp: OtpService,
  ) {}

  async requestOtp(data: RequestOtpDto, ip?: string) {
    const sent = await this.otp.send(data.phoneNumber, ip);

    // Same response whether or not an account exists for this number.
    const { exposeCode } = getOtpConfig();
    if (exposeCode) console.log(`OTP for ${data.phoneNumber}: ${sent.code}`);

    return {
      message: 'OTP sent successfully',
      phoneNumber: data.phoneNumber,
      expiresInSeconds: sent.expiresInSeconds,
      retryAfterSeconds: sent.retryAfterSeconds,
      nextAllowedAt: sent.nextAllowedAt,
      ...(exposeCode ? { code: sent.code } : {}),
    };
  }

  async verifyOtp(data: VerifyOtpDto, ctx: SessionContext = {}) {
    await this.otp.verify(data.phoneNumber, data.code);

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

    const tokens = await this.sessions.createSession(user, ctx);
    return {
      user,
      tokens,
    };
  }

  async technicianLogin(data: TechnicianLoginDto, ctx: SessionContext = {}) {
    const validPassword = process.env.TECHNICIAN_DEFAULT_PASSWORD || '123456';

    if (data.password !== validPassword) {
      throw new UnauthorizedException('Invalid phone number or password');
    }

    let user = await this.prisma.user.findUnique({
      where: {
        mobileNumber: data.phoneNumber,
      },
      include: {
        technicianProfile: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Technician account not found with this phone number',
      );
    }

    if (user.role !== UserRole.TECHNICIAN) {
      throw new UnauthorizedException(
        `This phone number is registered as ${user.role}. Each phone number can only have one role and cannot be used as a technician.`,
      );
    }

    await this.prisma.technicianProfile.upsert({
      where: { userId: user.id },
      update: {
        lastLoginAt: new Date(),
      },
      create: {
        userId: user.id,
        lastLoginAt: new Date(),
      },
    });

    if (user.status !== 'ACTIVE' || !user.isVerified) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          status: 'ACTIVE',
          isVerified: true,
        },
        include: {
          technicianProfile: true,
        },
      });
    }

    const tokens = await this.sessions.createSession(user, ctx);

    return {
      user: {
        id: user.id,
        mobileNumber: user.mobileNumber,
        email: user.email,
        name: user.name,
        profilePhoto: user.profilePhoto,
        role: user.role,
        status: user.status,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      // Technician login keeps the legacy body-token response.
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
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

    // Strict single role constraint: A phone number cannot have more than one role
    if (user.name && data.role && data.role !== user.role) {
      throw new BadRequestException(
        `A single phone number cannot have more than one role. This phone number is already registered as ${user.role}.`,
      );
    }

    const role = user.name ? user.role : data.role || user.role;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: {
          id: userid,
        },
        data: {
          name: data.fullName !== undefined ? data.fullName : user.name,
          email: data.email !== undefined ? data.email : user.email,
          profilePhoto:
            data.profilePhoto !== undefined
              ? data.profilePhoto
              : user.profilePhoto,
          role,
        },
      });
      await this.ensureProfile(tx, userid, role);
    });

    return this.getMe(userid);
  }

  async switchProfile(userId: string, role: UserRole) {
    const validRoles: UserRole[] = Object.values(UserRole);

    if (!validRoles.includes(role)) {
      throw new BadRequestException('Invalid role specified');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Strict single role constraint: A single phone number can never have more than one role
    if (user.role !== role) {
      throw new BadRequestException(
        `A single phone number cannot have more than one role. This account is permanently registered as ${user.role}.`,
      );
    }

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
            totalCompletedOrders: true,
            level: true,
            monthlyEarnings: true,
            walletBalance: true,
            isBlockedForNegative: true,
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
        technicianProfile: {
          select: {
            id: true,
            providerAgencyId: true,
            lastLoginAt: true,
            invitedAt: true,
            currentLat: true,
            currentLong: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!user) return null;

    // Strict single role constraint: Each phone number has only its single assigned role
    const availableRoles: UserRole[] = [user.role];

    return {
      ...user,
      availableRoles,
      activeProfile: this.getActiveProfile(user),
    };
  }

  private getActiveProfile(user: {
    role: UserRole;
    customerProfile: unknown;
    providerProfile: unknown;
    counselorProfile: unknown;
    technicianProfile?: unknown;
  }) {
    if (user.role === UserRole.CUSTOMER) return user.customerProfile;
    if (user.role === UserRole.PROVIDER) return user.providerProfile;
    if (user.role === UserRole.COUNSELOR) return user.counselorProfile;
    if (user.role === UserRole.TECHNICIAN) return user.technicianProfile;
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

    if (role === UserRole.TECHNICIAN) {
      await tx.technicianProfile.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });
    }
  }

  async rechargeProviderWallet(userId: string, amount: number) {
    if (amount <= 0) {
      throw new BadRequestException(
        'Recharge amount must be greater than zero',
      );
    }

    const provider = await this.prisma.providerProfile.findUnique({
      where: { userId },
    });

    if (!provider) {
      throw new NotFoundException('Provider profile not found');
    }

    const currentBalance = Number(provider.walletBalance);
    const newBalance = currentBalance + amount;
    const isBlockedForNegative = newBalance < 0;

    await this.prisma.providerProfile.update({
      where: { id: provider.id },
      data: {
        walletBalance: newBalance,
        isBlockedForNegative,
      },
    });

    return this.getMe(userId);
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
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
import { LocationsService } from '../locations/locations.service';
import { SELF_SERVICE_SIGNUP_ROLES } from './role-policy';
import { phoneLookupVariants } from '../../common/phone';
import { kycAllowsOrders } from '../provider-kyc/kyc-rules';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

const USER_SELECT = {
  id: true,
  mobileNumber: true,
  email: true,
  name: true,
  username: true,
  districtId: true,
  upazilaId: true,
  profilePhoto: true,
  role: true,
  status: true,
  isVerified: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly otp: OtpService,
    private readonly locations: LocationsService,
  ) {}

  async requestOtp(data: RequestOtpDto, ip?: string) {
    const sent = await this.otp.send(data.phoneNumber, ip);

    // Same response whether or not an account exists for this number.
    const { exposeCode, logCodeToConsole } = getOtpConfig();
    if (logCodeToConsole) {
      this.logger.warn(
        `[DEV ONLY] OTP for ${data.phoneNumber}: ${sent.code} (valid ${sent.expiresInSeconds}s)`,
      );
    }

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

    // An existing account is found however its number was written (+880..., 880..., 01...). Otherwise a second,
    // empty customer account would be made next to the real one, and the person would land in the wrong role.
    const existingId = await this.findUserIdByPhone(data.phoneNumber);
    // Signing in must never lift a block or a ban: only staff can (admin-members moderation).
    if (existingId) await this.assertNotBlocked(existingId);
    const user = existingId
      ? await this.prisma.user.update({ where: { id: existingId }, data: { isVerified: true, status: 'ACTIVE' }, select: USER_SELECT })
      : await this.prisma.user.create({ data: { mobileNumber: data.phoneNumber, isVerified: true, status: 'ACTIVE' }, select: USER_SELECT });

    // Profile fields are optional, so a customer who only verified a number still needs the
    // profile row that orders hang off.
    if (user.role === UserRole.CUSTOMER) {
      await this.prisma.customerProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    }

    const tokens = await this.sessions.createSession(user, ctx);
    return {
      user,
      tokens,
    };
  }

  /** A blocked (SUSPENDED) or BANNED account cannot sign in; INACTIVE accounts are reactivated by signing in. */
  private async assertNotBlocked(userId: string) {
    const account = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (account?.status === 'BANNED') throw new ForbiddenException('This account is banned. Please contact support.');
    if (account?.status === 'SUSPENDED') throw new ForbiddenException('This account is blocked. Please contact support.');
  }

  /** The account for a phone number, matching the exact stored form first and the other known forms after it. */
  private async findUserIdByPhone(phone: string): Promise<string | null> {
    const matches = await this.prisma.user.findMany({
      where: { mobileNumber: { in: phoneLookupVariants(phone) } },
      select: { id: true, mobileNumber: true },
    });
    return (matches.find((match) => match.mobileNumber === phone) ?? matches[0])?.id ?? null;
  }

  async technicianLogin(data: TechnicianLoginDto, ctx: SessionContext = {}) {
    const validPassword = process.env.TECHNICIAN_DEFAULT_PASSWORD || '123456';

    if (data.password !== validPassword) {
      throw new UnauthorizedException('Invalid phone number or password');
    }

    const existingId = await this.findUserIdByPhone(data.phoneNumber);
    let user = existingId
      ? await this.prisma.user.findUnique({ where: { id: existingId }, include: { technicianProfile: true } })
      : null;

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
    // Signing in must never lift a block or a ban.
    await this.assertNotBlocked(user.id);

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

    // ADMIN, MANAGER, SUPPORT and TECHNICIAN accounts are created by an administrator;
    // nobody may pick them for themselves while signing up.
    if (!user.name && data.role && !SELF_SERVICE_SIGNUP_ROLES.includes(data.role)) {
      throw new ForbiddenException(
        `The ${data.role} role can only be granted by an administrator`,
      );
    }

    // Strict single role constraint: A phone number cannot have more than one role
    if (user.name && data.role && data.role !== user.role) {
      throw new BadRequestException(
        `A single phone number cannot have more than one role. This phone number is already registered as ${user.role}.`,
      );
    }

    // A brand-new account (no name yet) needs a name and a username.
    // The location is optional.
    if (!user.name) {
      const missing = (
        [
          ['fullName', data.fullName],
          ['username', data.username],
        ] as const
      )
        .filter(([, value]) => value === undefined || value === '')
        .map(([field]) => field);
      if (missing.length > 0) {
        throw new BadRequestException(
          `Missing required fields: ${missing.join(', ')}`,
        );
      }
    }

    if (data.username !== undefined) {
      const isTaken = await this.isUsernameTaken(data.username, userid);
      if (isTaken) throw new BadRequestException('Username already taken');
    }

    // Location is optional, but district and upazila go together: both set
    // (and a real pair), or both null to clear it.
    const isClearingLocation =
      data.districtId === null && data.upazilaId === null;
    if (!isClearingLocation) {
      const hasDistrict = data.districtId != null;
      const hasUpazila = data.upazilaId != null;
      if (hasDistrict !== hasUpazila) {
        throw new BadRequestException(
          'Send districtId and upazilaId together',
        );
      }
      if (
        hasDistrict &&
        !this.locations.isValidLocation(data.districtId!, data.upazilaId!)
      ) {
        throw new BadRequestException(
          'Upazila does not belong to the district',
        );
      }
    }

    const role = user.name ? user.role : data.role || user.role;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: {
          id: userid,
        },
        data: {
          name: data.fullName !== undefined ? data.fullName : user.name,
          username: data.username !== undefined ? data.username : user.username,
          districtId:
            data.districtId !== undefined ? data.districtId : user.districtId,
          upazilaId:
            data.upazilaId !== undefined ? data.upazilaId : user.upazilaId,
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

  /** Public check behind the sign-up form's username tick. */
  async checkUsername(username: string) {
    const normalized = (username ?? '').trim();
    if (!USERNAME_PATTERN.test(normalized)) {
      return { available: false, reason: 'INVALID' as const };
    }
    const isTaken = await this.isUsernameTaken(normalized);
    return isTaken
      ? { available: false, reason: 'TAKEN' as const }
      : { available: true as const };
  }

  private async isUsernameTaken(username: string, exceptUserId?: string) {
    const existing = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    return Boolean(existing && existing.id !== exceptUserId);
  }

  async switchProfile(userId: string, role: UserRole) {
    const validRoles: UserRole[] = Object.values(UserRole);

    if (!validRoles.includes(role)) {
      throw new BadRequestException('Invalid role specified');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, providerProfile: { select: { kycGraceUntil: true, kyc: { select: { status: true } } } } },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }
    if (user.role === role) return this.getMe(userId);

    /*
     * One number, two sides: a customer who is also a verified provider switches between the two with Switch
     * Account. The active side is User.role, which every request reads fresh, so the whole app follows at once.
     * Every other change of role (technician, staff, counselor) stays impossible, as before.
     */
    const isCustomerToProvider = user.role === UserRole.CUSTOMER && role === UserRole.PROVIDER;
    const isProviderToCustomer = user.role === UserRole.PROVIDER && role === UserRole.CUSTOMER;
    if (!isCustomerToProvider && !isProviderToCustomer) {
      throw new BadRequestException(`This account is registered as ${user.role} and cannot switch to ${role}.`);
    }
    if (isCustomerToProvider && !(user.providerProfile && kycAllowsOrders(user.providerProfile))) {
      throw new ForbiddenException('Your provider verification (KYC) must be approved before you can switch to provider.');
    }

    await this.prisma.$transaction(async (tx) => {
      // A provider switching to customer for the first time gets their customer side now.
      await this.ensureProfile(tx, userId, role);
      await tx.user.update({ where: { id: userId }, data: { role } });
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
        // The default saved address fills the Place Order form, so the customer does not type it every time.
        addresses: {
          where: { isDefault: true },
          take: 1,
          select: { id: true, addressText: true, isDefault: true },
        },
        customerProfile: {
          select: {
            id: true,
            address: true,
            gender: true,
            dateOfBirth: true,
            // Average of the ratings providers gave this customer; shown in the customer's own header.
            rating: true,
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

    // The sides this number can switch to: a provider can always be a customer too; a customer can be a provider once
    // their KYC is approved (or they were a provider before KYC and are in their grace period). Others: one role.
    const availableRoles: UserRole[] = [user.role];
    if (user.role === UserRole.PROVIDER) availableRoles.push(UserRole.CUSTOMER);
    if (user.role === UserRole.CUSTOMER && (await this.canActAsProvider(userId))) availableRoles.push(UserRole.PROVIDER);

    return {
      ...user,
      ...(await this.lastOrderPlaceFallback(user)),
      availableRoles,
      activeProfile: this.getActiveProfile(user),
    };
  }

  /**
   * A customer whose orders predate the saved address (or whose save failed) has no default address yet.
   * Their latest order's place fills the Place Order form instead, so they never type it twice.
   */
  private async lastOrderPlaceFallback(user: {
    role: UserRole;
    districtId: number | null;
    upazilaId: number | null;
    addresses: Array<{ id: string; addressText: string; isDefault: boolean }>;
    customerProfile: { id: string } | null;
  }) {
    const hasArea = Boolean(user.districtId && user.upazilaId);
    if (user.role !== UserRole.CUSTOMER || !user.customerProfile || (user.addresses.length > 0 && hasArea)) {
      return {};
    }

    const last = await this.prisma.orderBookingDetail.findFirst({
      where: { order: { customerId: user.customerProfile.id } },
      orderBy: { createdAt: 'desc' },
      select: { orderId: true, addressDetail: true, districtId: true, upazilaId: true },
    });
    if (!last) return {};

    return {
      ...(hasArea ? {} : { districtId: last.districtId, upazilaId: last.upazilaId }),
      ...(user.addresses.length > 0
        ? {}
        : { addresses: [{ id: last.orderId, addressText: last.addressDetail, isDefault: true }] }),
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

  private async canActAsProvider(userId: string): Promise<boolean> {
    const profile = await this.prisma.providerProfile.findUnique({
      where: { userId },
      select: { kycGraceUntil: true, kyc: { select: { status: true } } },
    });
    return Boolean(profile && kycAllowsOrders(profile));
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
        // Same rule as paying the due: a cleared wallet makes the provider available again.
        isAvailable: !isBlockedForNegative,
      },
    });

    return this.getMe(userId);
  }
}

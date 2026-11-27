import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OfferStatus, OrderStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { providerAccountWhere } from '../provider-kyc/kyc-rules';
import { LocationsService } from '../locations/locations.service';
import { ratingsFromProviders, reviewsFromCustomers } from '../provider-review/received-reviews';
import { CreateMemberDto } from './dto/create-member.dto';
import { ModerationAction } from './dto/moderate-member.dto';

/** The people staff manage here. Staff accounts are never moderated through this screen. */
const MANAGEABLE_ROLES: UserRole[] = [UserRole.PROVIDER, UserRole.TECHNICIAN, UserRole.CUSTOMER];

interface Actor {
  id: string;
  role: string;
}

const MEMBER_SELECT = {
  id: true,
  name: true,
  username: true,
  mobileNumber: true,
  email: true,
  profilePhoto: true,
  role: true,
  status: true,
  isRestricted: true,
  isVerified: true,
  districtId: true,
  upazilaId: true,
  createdAt: true,
  addresses: { select: { addressText: true, isDefault: true }, orderBy: { createdAt: 'asc' as const }, take: 5 },
  moderationLog: { select: { action: true, reason: true, createdAt: true }, orderBy: { createdAt: 'desc' as const }, take: 10 },
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
  ) {}

  /**
   * Adds a provider or a customer. The number is their identity and there is no sign-up step to wait for,
   * so the account starts active and verified; they sign in later with OTP on this number. A provider who
   * is given a location also starts with that upazila as the area they take orders in.
   */
  async create(data: CreateMemberDto) {
    const hasDistrict = data.districtId !== undefined;
    const hasUpazila = data.upazilaId !== undefined;
    if (hasDistrict !== hasUpazila) throw new BadRequestException('Send the district and the upazila together');
    if (hasDistrict && !this.locations.isValidLocation(data.districtId!, data.upazilaId!)) {
      throw new BadRequestException('The upazila does not belong to the district');
    }

    const existing = await this.prisma.user.findUnique({ where: { mobileNumber: data.mobileNumber }, select: { role: true } });
    if (existing) {
      throw new ConflictException(`This phone number is already registered as ${existing.role.toLowerCase()}. A number can only have one role.`);
    }

    const role = data.role === 'PROVIDER' ? UserRole.PROVIDER : UserRole.CUSTOMER;
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          mobileNumber: data.mobileNumber,
          name: data.name?.trim() || null,
          role,
          status: UserStatus.ACTIVE,
          isVerified: true,
          districtId: data.districtId,
          upazilaId: data.upazilaId,
        },
        select: { id: true, role: true },
      });
      if (role === UserRole.CUSTOMER) {
        await tx.customerProfile.create({ data: { userId: created.id } });
      } else {
        const provider = await tx.providerProfile.create({ data: { userId: created.id, companyName: data.companyName?.trim() || null }, select: { id: true } });
        if (hasDistrict) await tx.providerServiceArea.create({ data: { providerId: provider.id, districtId: data.districtId!, upazilaId: data.upazilaId! } });
      }
      return created;
    });
    return user;
  }

  /** Everything staff need to know about one provider, technician or customer. */
  async getDetails(memberId: string) {
    const member = await this.prisma.user.findUnique({ where: { id: memberId }, select: MEMBER_SELECT });
    if (!member || !MANAGEABLE_ROLES.includes(member.role)) throw new NotFoundException('Member not found');

    const base = { ...member, area: this.areaName(member.districtId, member.upazilaId) };
    if (member.role === UserRole.PROVIDER) return { ...base, provider: await this.providerSection(memberId) };
    if (member.role === UserRole.TECHNICIAN) return { ...base, technician: await this.technicianSection(memberId) };
    // A customer who is also a provider (one number, both sides) or who applied to be one: staff see the provider
    // side too, with its KYC to review.
    const providerAccount = await this.prisma.providerProfile.findFirst({ where: { userId: memberId, ...providerAccountWhere() }, select: { id: true } });
    return { ...base, customer: await this.customerSection(memberId), ...(providerAccount ? { provider: await this.providerSection(memberId) } : {}) };
  }

  /**
   * Sets a provider's own commission percent. New orders, and orders they accept from now on, use it; an order
   * they already have keeps the percent it was given (Order.commissionRate).
   */
  async setCommission(memberId: string, commissionRate: number) {
    const updated = await this.prisma.providerProfile.updateMany({ where: { userId: memberId }, data: { commissionRate } });
    if (updated.count === 0) throw new NotFoundException('Provider not found');
    return this.getDetails(memberId);
  }

  async moderate(actor: Actor, memberId: string, action: ModerationAction, reason?: string) {
    if (actor.id === memberId) throw new ForbiddenException('You cannot moderate your own account');
    const isBanAction = action === 'BAN' || action === 'UNBAN';
    // Banning is the heaviest step, so it stays with admins; managers may restrict and block.
    if (isBanAction && actor.role !== UserRole.ADMIN) throw new ForbiddenException('Only an admin can ban or unban');

    const member = await this.prisma.user.findUnique({ where: { id: memberId }, select: { id: true, role: true, status: true, isRestricted: true } });
    if (!member || !MANAGEABLE_ROLES.includes(member.role)) throw new NotFoundException('Member not found');

    const change = this.planChange(action, member);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: memberId }, data: change });
      await tx.userModerationLog.create({ data: { userId: memberId, actorId: actor.id, action, reason: reason?.trim() || null } });

      // Locked-out people lose their sessions at once, so no refresh token keeps them signed in.
      if (change.status && change.status !== UserStatus.ACTIVE) {
        await tx.refreshToken.updateMany({ where: { userId: memberId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      // A provider who is no longer fit to take orders stops being offered the ones still open.
      if (change.isRestricted === true || (change.status && change.status !== UserStatus.ACTIVE)) {
        await tx.orderOffer.updateMany({
          where: { provider: { userId: memberId }, status: OfferStatus.OFFERED },
          data: { status: OfferStatus.WITHDRAWN, respondedAt: new Date() },
        });
      }
    });

    return this.getDetails(memberId);
  }

  /** What each action changes, and which state it is allowed to start from. */
  private planChange(action: ModerationAction, member: { status: UserStatus; isRestricted: boolean }): Prisma.UserUpdateInput {
    switch (action) {
      case 'RESTRICT':
        return { isRestricted: true };
      case 'UNRESTRICT':
        return { isRestricted: false };
      case 'BLOCK':
        if (member.status === UserStatus.BANNED) throw new BadRequestException('This account is banned');
        return { status: UserStatus.SUSPENDED };
      case 'UNBLOCK':
        if (member.status !== UserStatus.SUSPENDED) throw new BadRequestException('This account is not blocked');
        return { status: UserStatus.ACTIVE };
      case 'BAN':
        return { status: UserStatus.BANNED };
      case 'UNBAN':
        if (member.status !== UserStatus.BANNED) throw new BadRequestException('This account is not banned');
        return { status: UserStatus.ACTIVE };
    }
  }

  private areaName(districtId: number | null, upazilaId: number | null) {
    if (!districtId) return null;
    const district = this.locations.getDistricts().find((item) => item.id === districtId);
    const upazila = upazilaId ? this.locations.getUpazilas(districtId).find((item) => item.id === upazilaId) : null;
    return [upazila?.bnName, district?.bnName].filter(Boolean).join(', ') || null;
  }

  private async providerSection(userId: string) {
    const profile = await this.prisma.providerProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        companyName: true,
        bio: true,
        rating: true,
        level: true,
        experienceYears: true,
        isAvailable: true,
        isBlockedForNegative: true,
        walletBalance: true,
        commissionRate: true,
        totalCompletedOrders: true,
        kyc: { select: { status: true } },
        serviceAreas: { select: { districtId: true, upazilaId: true } },
        technicianProfiles: {
          select: { lastLoginAt: true, user: { select: { id: true, name: true, username: true, mobileNumber: true, status: true, profilePhoto: true } } },
        },
        _count: { select: { orders: true } },
      },
    });
    if (!profile) return null;

    const [skills, ordersByStatus, reviews] = await Promise.all([
      this.prisma.serviceAssignee.count({ where: { userId, isActive: true } }),
      this.prisma.order.groupBy({ by: ['orderStatus'], where: { providerId: profile.id, NOT: { orderStatus: OrderStatus.PENDING } }, _count: true }),
      reviewsFromCustomers(this.prisma, { providerId: profile.id }),
    ]);

    const { walletBalance, serviceAreas, technicianProfiles, ...rest } = profile;
    return {
      ...rest,
      rating: Number(rest.rating),
      commissionRate: Number(rest.commissionRate),
      // A negative wallet is what the provider owes the platform.
      dueAmount: Number(walletBalance) < 0 ? -Number(walletBalance) : 0,
      skillCount: skills,
      areas: serviceAreas.map((area) => ({ ...area, name: this.areaName(area.districtId, area.upazilaId) })),
      technicians: technicianProfiles.map((technician) => ({ ...technician.user, lastLoginAt: technician.lastLoginAt })),
      ordersByStatus: Object.fromEntries(ordersByStatus.map((row) => [row.orderStatus, row._count])),
      reviews,
    };
  }

  private async technicianSection(userId: string) {
    // A technician account made outside the admin form (seed data, an older import) can lack its profile row.
    // Without it there is nothing to attach a provider to, so the row is created here; it is empty and harmless.
    const profile = await this.prisma.technicianProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: {
        id: true,
        lastLoginAt: true,
        providerAgencyId: true,
        providerAgency: { select: { companyName: true, user: { select: { name: true, username: true, mobileNumber: true } } } },
        _count: { select: { orders: true } },
      },
    });
    // Customers review the order; the technician who did it sees those reviews on their profile.
    const reviews = await reviewsFromCustomers(this.prisma, { order: { technicianId: profile.id } });
    return (
      profile && {
        // The technician profile id is what "change provider" is sent against.
        profileId: profile.id,
        lastLoginAt: profile.lastLoginAt,
        orderCount: profile._count.orders,
        reviews,
        provider: profile.providerAgency && {
          profileId: profile.providerAgencyId,
          name: profile.providerAgency.companyName || profile.providerAgency.user.name || profile.providerAgency.user.username,
          mobileNumber: profile.providerAgency.user.mobileNumber,
        },
      }
    );
  }

  private async customerSection(userId: string) {
    const profile = await this.prisma.customerProfile.findUnique({ where: { userId }, select: { id: true, rating: true } });
    if (!profile) return { orderCount: 0, ordersByStatus: {}, totalSpent: 0, rating: 0, recentOrders: [], services: [], ratings: [] };

    const where = { customerId: profile.id };
    const [byStatus, spent, recent, perService, ratings] = await Promise.all([
      this.prisma.order.groupBy({ by: ['orderStatus'], where, _count: true }),
      this.prisma.order.aggregate({ where: { ...where, orderStatus: OrderStatus.COMPLETED }, _sum: { totalPrice: true } }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          referenceCode: true,
          orderStatus: true,
          totalPrice: true,
          createdAt: true,
          service: { select: { name: true } },
          provider: { select: { companyName: true, user: { select: { name: true, username: true } } } },
        },
      }),
      this.prisma.order.groupBy({ by: ['serviceId'], where, _count: true, orderBy: { _count: { serviceId: 'desc' } }, take: 8 }),
      // What providers and technicians said about this customer after their orders.
      ratingsFromProviders(this.prisma, where),
    ]);

    const serviceNames = await this.prisma.service.findMany({ where: { id: { in: perService.map((row) => row.serviceId) } }, select: { id: true, name: true } });
    const nameById = new Map(serviceNames.map((service) => [service.id, service.name]));

    return {
      orderCount: byStatus.reduce((sum, row) => sum + row._count, 0),
      ordersByStatus: Object.fromEntries(byStatus.map((row) => [row.orderStatus, row._count])),
      totalSpent: Number(spent._sum.totalPrice ?? 0),
      rating: Number(profile.rating),
      ratings,
      recentOrders: recent.map((order) => ({
        id: order.id,
        referenceCode: order.referenceCode,
        orderStatus: order.orderStatus,
        totalPrice: Number(order.totalPrice),
        createdAt: order.createdAt,
        serviceName: order.service.name,
        providerName: order.provider.companyName || order.provider.user.name || order.provider.user.username,
      })),
      services: perService.map((row) => ({ name: nameById.get(row.serviceId) ?? 'Service', count: row._count })),
    };
  }
}

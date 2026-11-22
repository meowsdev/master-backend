import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { phoneLookupVariants } from '../../common/phone';
import {
  AdminCreateTechnicianDto,
  ProviderAddTechnicianDto,
  UpdateMyTechnicianLocationDto,
} from './dto/technician-profile.dto';

const TECHNICIAN_USER_SELECT = {
  id: true,
  name: true,
  mobileNumber: true,
  role: true,
  status: true,
} as const;

/**
 * An ADMIN creates technicians for any provider and moves them between providers (AGENTS.md §10,
 * auth/role-policy.ts). A PROVIDER may add technicians to their OWN team only (listMyTeam / addToMyTeam);
 * they can never take a technician from another provider. The controller enforces the roles.
 */
@Injectable()
export class TechnicianProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async createByAdmin(data: AdminCreateTechnicianDto) {
    await this.assertProviderAgency(data.providerAgencyId);

    const existingUser = await this.prisma.user.findUnique({
      where: { mobileNumber: data.mobileNumber },
      include: { technicianProfile: { select: { id: true } } },
    });

    if (existingUser && existingUser.role !== UserRole.TECHNICIAN) {
      throw new ConflictException(
        `This phone number is already registered as ${existingUser.role}. A number can only have one role.`,
      );
    }
    if (existingUser?.technicianProfile) {
      throw new ConflictException('This phone number is already a technician');
    }

    return this.prisma.$transaction(async (tx) => {
      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            mobileNumber: data.mobileNumber,
            name: data.name,
            role: UserRole.TECHNICIAN,
            // Created by an admin, so there is no sign-up/OTP step to wait for.
            status: 'ACTIVE',
            isVerified: true,
          },
        }));

      return tx.technicianProfile.create({
        data: {
          userId: user.id,
          providerAgencyId: data.providerAgencyId,
          invitedAt: new Date(),
        },
        include: { user: { select: TECHNICIAN_USER_SELECT }, providerAgency: true },
      });
    });
  }

  /** The signed-in provider's own technicians (their team), with how many jobs each has running. */
  async listMyTeam(providerUserId: string) {
    const provider = await this.loadProvider(providerUserId);
    const technicians = await this.prisma.technicianProfile.findMany({
      where: { providerAgencyId: provider.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        user: { select: { name: true, username: true, profilePhoto: true, mobileNumber: true, status: true } },
        _count: { select: { orders: { where: { orderStatus: { in: [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS] } } } } },
      },
    });

    return technicians.map(({ user, _count, ...technician }) => ({
      ...technician,
      name: user.name,
      username: user.username,
      profilePhoto: user.profilePhoto,
      // The provider typed this number in when adding the technician, so it is shown back to them.
      mobileNumber: user.mobileNumber,
      isActive: user.status === UserStatus.ACTIVE,
      activeJobs: _count.orders,
    }));
  }

  /**
   * A provider adds a technician to their own team. A new number becomes a technician account under this
   * provider; a technician with no provider yet joins this one. A number that already has another role, or a
   * technician who already works for another provider, is refused (only an admin moves technicians).
   */
  async addToMyTeam(providerUserId: string, data: ProviderAddTechnicianDto) {
    const provider = await this.loadProvider(providerUserId);
    const name = data.name.trim();

    const existingUser = await this.prisma.user.findFirst({
      where: { mobileNumber: { in: phoneLookupVariants(data.mobileNumber) } },
      select: { id: true, role: true, technicianProfile: { select: { id: true, providerAgencyId: true } } },
    });

    if (existingUser && existingUser.role !== UserRole.TECHNICIAN) {
      throw new ConflictException(
        `This phone number is already registered as ${existingUser.role.toLowerCase()}. A number can only have one role.`,
      );
    }

    const technicianProfile = existingUser?.technicianProfile;
    if (technicianProfile?.providerAgencyId === provider.id) {
      throw new ConflictException('This technician is already in your team');
    }
    if (technicianProfile?.providerAgencyId) {
      throw new ConflictException('This technician already works for another provider. Ask support to move them.');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (technicianProfile) {
        return tx.technicianProfile.update({ where: { id: technicianProfile.id }, data: { providerAgencyId: provider.id, invitedAt: new Date() } });
      }

      const user =
        existingUser ??
        (await tx.user.create({
          data: {
            mobileNumber: data.mobileNumber,
            name,
            role: UserRole.TECHNICIAN,
            // Added by their provider, so there is no sign-up/OTP step to wait for.
            status: 'ACTIVE',
            isVerified: true,
          },
        }));

      return tx.technicianProfile.create({
        data: { userId: user.id, providerAgencyId: provider.id, invitedAt: new Date() },
      });
    });

    return { id: created.id, name, mobileNumber: data.mobileNumber };
  }

  private async loadProvider(providerUserId: string) {
    const provider = await this.prisma.providerProfile.findUnique({ where: { userId: providerUserId }, select: { id: true } });
    if (!provider) throw new NotFoundException('Provider profile not found');
    return provider;
  }

  /** Every technician with the provider agency they work under (admin screen). */
  listForAdmin() {
    return this.prisma.technicianProfile.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, username: true, mobileNumber: true, status: true } },
        providerAgency: { select: { id: true, companyName: true, user: { select: { name: true, username: true } } } },
      },
    });
  }

  async assignAgency(profileId: string, providerAgencyId: string | null) {
    const current = await this.prisma.technicianProfile.findUnique({ where: { id: profileId }, select: { id: true, providerAgencyId: true } });
    if (!current) throw new NotFoundException('Technician profile not found');
    if (providerAgencyId) await this.assertProviderAgency(providerAgencyId);

    // Moving a technician in the middle of a job would leave that job with a technician from another provider.
    if (current.providerAgencyId !== providerAgencyId) {
      const activeJobs = await this.prisma.order.count({ where: { technicianId: profileId, orderStatus: { in: [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS] } } });
      if (activeJobs > 0) {
        throw new ConflictException(`This technician has ${activeJobs} active job(s). Move them after the jobs are finished.`);
      }
    }

    return this.prisma.technicianProfile.update({
      where: { id: profileId },
      data: { providerAgencyId },
      include: { user: { select: TECHNICIAN_USER_SELECT }, providerAgency: true },
    });
  }

  async removeByAdmin(profileId: string) {
    await this.assertExists(profileId);
    await this.prisma.technicianProfile.delete({ where: { id: profileId } });
    return { message: 'Technician profile deleted successfully' };
  }

  findMine(userId: string) {
    return this.prisma.technicianProfile.findUnique({
      where: { userId },
      include: { providerAgency: true },
    });
  }

  async findOne(id: string) {
    const profile = await this.prisma.technicianProfile.findUnique({
      where: { id },
      include: { user: { select: TECHNICIAN_USER_SELECT }, providerAgency: true },
    });

    if (!profile) throw new NotFoundException('Technician profile not found');
    return profile;
  }

  /** A technician reports where they are. Their agency can't be changed from here. */
  async updateMyLocation(userId: string, data: UpdateMyTechnicianLocationDto) {
    const existing = await this.prisma.technicianProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Technician profile not found');

    return this.prisma.technicianProfile.update({
      where: { userId },
      data: { currentLat: data.currentLat, currentLong: data.currentLong },
      include: { providerAgency: true },
    });
  }

  private async assertExists(profileId: string) {
    const existing = await this.prisma.technicianProfile.findUnique({
      where: { id: profileId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Technician profile not found');
  }

  private async assertProviderAgency(providerAgencyId?: string) {
    if (!providerAgencyId) return;

    const provider = await this.prisma.providerProfile.findUnique({
      where: { id: providerAgencyId },
      select: { id: true, user: { select: { role: true } } },
    });

    if (!provider || provider.user.role !== UserRole.PROVIDER) throw new BadRequestException('Provider agency not found');
  }
}

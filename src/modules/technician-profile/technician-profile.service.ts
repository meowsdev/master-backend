import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdminCreateTechnicianDto,
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
 * Technicians are created and attached to providers by an ADMIN only
 * (AGENTS.md §10, auth/role-policy.ts). The controller enforces the role; the
 * methods below assume the caller has already been checked.
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
    await this.assertExists(profileId);
    if (providerAgencyId) await this.assertProviderAgency(providerAgencyId);

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
      select: { id: true },
    });

    if (!provider) throw new BadRequestException('Provider agency not found');
  }
}

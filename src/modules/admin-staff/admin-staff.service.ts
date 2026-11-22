import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { phoneLookupVariants } from '../../common/phone';
import { PrismaService } from '../../prisma/prisma.service';
import { GRANTABLE_STAFF_ROLES } from '../auth/role-policy';
import { CreateStaffDto, UpdateStaffDto } from './dto/admin-staff.dto';

const STAFF_SELECT = { id: true, name: true, mobileNumber: true, role: true, status: true, isVerified: true, createdAt: true } as const;

/** Office accounts shown on the Staff screen: the positions an admin gives, plus the admins themselves (read only). */
const LISTED_ROLES: UserRole[] = [UserRole.ADMIN, ...GRANTABLE_STAFF_ROLES];

const isGrantable = (role: UserRole) => (GRANTABLE_STAFF_ROLES as readonly UserRole[]).includes(role);

/*
 * Office staff (Manager, Support, HR, Counselor), managed by an admin from the website. A number has one
 * role only, so a customer's or provider's number can never become staff. Admin accounts are listed but
 * never created, changed or turned off here.
 */
@Injectable()
export class AdminStaffService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.user.findMany({
      where: { role: { in: LISTED_ROLES } },
      select: STAFF_SELECT,
      orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /** The account starts active; they sign in with OTP on this number and land on their position's screen. */
  async create(data: CreateStaffDto) {
    const existing = await this.prisma.user.findFirst({
      where: { mobileNumber: { in: phoneLookupVariants(data.mobileNumber) } },
      select: { role: true },
    });
    if (existing) {
      throw new ConflictException(`This phone number is already registered as ${existing.role.toLowerCase()}. A number can only have one role.`);
    }

    const role = data.role as UserRole;
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { mobileNumber: data.mobileNumber, name: data.name.trim(), role, status: UserStatus.ACTIVE },
        select: STAFF_SELECT,
      });
      // Counselors keep their chat state on a profile row.
      if (role === UserRole.COUNSELOR) await tx.counselorProfile.create({ data: { userId: user.id } });
      return user;
    });
  }

  async update(staffId: string, data: UpdateStaffDto, actor: { id: string }) {
    if (data.role === undefined && data.status === undefined) throw new BadRequestException('Nothing to change');
    if (staffId === actor.id) throw new ForbiddenException('You cannot change your own account here');

    const staff = await this.prisma.user.findUnique({ where: { id: staffId }, select: { id: true, role: true, status: true } });
    if (!staff || !LISTED_ROLES.includes(staff.role)) throw new NotFoundException('Staff member not found');
    if (!isGrantable(staff.role)) throw new ForbiddenException('Admin accounts cannot be changed here');
    if (staff.status === UserStatus.BANNED) throw new BadRequestException('This account is banned');

    const newRole = data.role as UserRole | undefined;
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: staffId },
        data: { ...(newRole ? { role: newRole } : {}), ...(data.status ? { status: data.status } : {}) },
        select: STAFF_SELECT,
      });
      if (newRole === UserRole.COUNSELOR) {
        await tx.counselorProfile.upsert({ where: { userId: staffId }, update: {}, create: { userId: staffId } });
      }
      // A new position or a turned-off account takes effect at once: their sessions end and they sign in again.
      if ((newRole && newRole !== staff.role) || data.status === UserStatus.SUSPENDED) {
        await tx.refreshToken.updateMany({ where: { userId: staffId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return user;
    });
  }
}

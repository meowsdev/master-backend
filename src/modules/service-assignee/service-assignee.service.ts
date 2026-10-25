import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateServiceAssigneeDto,
  UpdateServiceAssigneeDto,
} from './dto/service-assignee.dto';

const ASSIGNABLE_ROLES: UserRole[] = [
  UserRole.PROVIDER,
  UserRole.COUNSELOR,
  UserRole.TECHNICIAN,
  UserRole.SUPPORT,
];

@Injectable()
export class ServiceAssigneeService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateServiceAssigneeDto) {
    await this.assertAssignableUser(data.userId);
    await this.assertActiveService(data.serviceId);

    return this.prisma.serviceAssignee.upsert({
      where: {
        userId_serviceId: {
          userId: data.userId,
          serviceId: data.serviceId,
        },
      },
      update: {
        isActive: data.isActive ?? true,
      },
      create: {
        userId: data.userId,
        serviceId: data.serviceId,
        isActive: data.isActive ?? true,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            mobileNumber: true,
            role: true,
            status: true,
          },
        },
        service: true,
      },
    });
  }

  findAll() {
    return this.prisma.serviceAssignee.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            mobileNumber: true,
            role: true,
            status: true,
          },
        },
        service: true,
      },
    });
  }

  findByService(serviceId: string) {
    return this.prisma.serviceAssignee.findMany({
      where: { serviceId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            mobileNumber: true,
            role: true,
            status: true,
          },
        },
      },
    });
  }

  findByUser(userId: string) {
    return this.prisma.serviceAssignee.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        service: true,
      },
    });
  }

  async findOne(id: string) {
    const assignee = await this.prisma.serviceAssignee.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            mobileNumber: true,
            role: true,
            status: true,
          },
        },
        service: true,
      },
    });

    if (!assignee) {
      throw new NotFoundException('Service assignee not found');
    }

    return assignee;
  }

  async update(id: string, data: UpdateServiceAssigneeDto) {
    await this.findOne(id);

    return this.prisma.serviceAssignee.update({
      where: { id },
      data,
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.serviceAssignee.delete({
      where: { id },
    });

    return { message: 'Service assignee deleted successfully' };
  }

  async deactivate(id: string) {
    await this.findOne(id);

    return this.prisma.serviceAssignee.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async syncMySkills(userId: string, serviceIds: string[]) {
    await this.assertAssignableUser(userId);

    if (serviceIds.length > 0) {
      const validServices = await this.prisma.service.findMany({
        where: { id: { in: serviceIds }, isActive: true, isDeleted: false },
        select: { id: true },
      });
      const validIds = new Set(validServices.map((s) => s.id));
      serviceIds = serviceIds.filter((id) => validIds.has(id));
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.serviceAssignee.deleteMany({
        where: {
          userId,
          serviceId: { notIn: serviceIds },
        },
      });

      for (const serviceId of serviceIds) {
        await tx.serviceAssignee.upsert({
          where: {
            userId_serviceId: {
              userId,
              serviceId,
            },
          },
          update: { isActive: true },
          create: {
            userId,
            serviceId,
            isActive: true,
          },
        });
      }

      return tx.serviceAssignee.findMany({
        where: { userId, isActive: true },
        include: { service: true },
      });
    });
  }

  private async assertAssignableUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new BadRequestException('Assignable user is not active');
    }

    if (!ASSIGNABLE_ROLES.includes(user.role)) {
      throw new BadRequestException('User role cannot be assigned to service');
    }
  }

  private async assertActiveService(serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, isActive: true, isDeleted: false },
      select: { id: true },
    });

    if (!service) {
      throw new BadRequestException('Service is unavailable');
    }
  }
}

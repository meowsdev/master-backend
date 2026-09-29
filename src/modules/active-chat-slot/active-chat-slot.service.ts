import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatSlotStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateActiveChatSlotDto,
  UpdateActiveChatSlotDto,
} from './dto/active-chat-slot.dto';

@Injectable()
export class ActiveChatSlotService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateActiveChatSlotDto) {
    await this.assertProvider(data.providerId);
    await this.assertCustomer(data.customerId);
    await this.assertService(data.serviceId);

    const runnitnOrder = await this.prisma.order.findFirst({
      where: {
        customerId: data.customerId,
        orderStatus: 'IN_PROGRESS',
        providerId: {
          not: data.providerId,
        },
      },
      include: {
        provider: {
          include: {
            user: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });

    if (runnitnOrder) {
      throw new BadRequestException(
        `Cannot switch provider. You currently have an active order in progress with ${runnitnOrder.provider.user.name || 'another provider'}. Please complete that order before switching providers. `,
      );
    }

    await this.prisma.activeChatSlot.updateMany({
      where: {
        customerId: data.customerId,
        providerId: { not: data.providerId },
        status: { in: [ChatSlotStatus.ACTIVE, ChatSlotStatus.PAUSED] },
      },
      data: {
        status: ChatSlotStatus.CLOSED,
      },
    });

    const existingSlot = await this.prisma.activeChatSlot.findFirst({
      where: {
        providerId: data.providerId,
        customerId: data.customerId,
        serviceId: data.serviceId,
      },
    });

    if (existingSlot) {
      return this.prisma.activeChatSlot.update({
        where: {
          id: existingSlot.id,
        },
        data: {
          status: ChatSlotStatus.ACTIVE,
        },
        include: this.includeRelations(),
      });
    }

    return this.prisma.activeChatSlot.create({
      data: {
        providerId: data.providerId,
        customerId: data.customerId,
        serviceId: data.serviceId,
        status: data.status ?? ChatSlotStatus.ACTIVE,
      },
      include: this.includeRelations(),
    });
  }

  findAll() {
    return this.prisma.activeChatSlot.findMany({
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  findByProvider(providerId: string) {
    return this.prisma.activeChatSlot.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  findByCustomer(customerId: string) {
    return this.prisma.activeChatSlot.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  async findOne(id: string) {
    const slot = await this.prisma.activeChatSlot.findUnique({
      where: { id },
      include: this.includeRelations(),
    });

    if (!slot) {
      throw new NotFoundException('Active chat slot not found');
    }

    return slot;
  }

  async update(id: string, data: UpdateActiveChatSlotDto) {
    await this.findOne(id);

    return this.prisma.activeChatSlot.update({
      where: { id },
      data,
      include: this.includeRelations(),
    });
  }

  async close(id: string) {
    await this.findOne(id);

    return this.prisma.activeChatSlot.update({
      where: { id },
      data: { status: ChatSlotStatus.CLOSED },
      include: this.includeRelations(),
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.activeChatSlot.delete({
      where: { id },
    });

    return { message: 'Active chat slot deleted successfully' };
  }

  private includeRelations() {
    return {
      provider: {
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
      },
      customer: {
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
      },
      service: true,
    };
  }

  private async assertProvider(providerId: string) {
    const provider = await this.prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { id: true },
    });

    if (!provider) {
      throw new BadRequestException('Provider profile not found');
    }
  }

  private async assertCustomer(customerId: string) {
    const customer = await this.prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: { id: true },
    });

    if (!customer) {
      throw new BadRequestException('Customer profile not found');
    }
  }

  private async assertService(serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, isActive: true, isDeleted: false },
      select: { id: true },
    });

    if (!service) {
      throw new BadRequestException('Service is unavailable');
    }
  }
}

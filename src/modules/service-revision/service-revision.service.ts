import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateServiceRevisionDto,
  UpdateServiceRevisionDto,
} from './dto/service-revision.dto';

@Injectable()
export class ServiceRevisionService {
  constructor(private readonly prisma: PrismaService) { }

  async create(data: CreateServiceRevisionDto) {
    const order = await this.assertOrder(data.orderId);
    if (order.orderStatus !== 'COMPLETED') {
      throw new BadRequestException('Revisions can only be requested for completed orders');
    }

    const orderComplitionTime = new Date(order.updatedAt).getTime()
    const threeDaysInMillis = 3 * 24 * 60 * 60 * 1000
    const isWarrantyExpired = Date.now() - orderComplitionTime > threeDaysInMillis


    if (isWarrantyExpired) {
      throw new BadRequestException('Warranty revision window (3 days) has expired for this order')
    }

    const defaultWarrentyExpiresAt = new Date(orderComplitionTime + threeDaysInMillis)


    return this.prisma.serviceRevision.create({
      data: {
        orderId: data.orderId,
        issueDescription: data.issueDescription,
        attachedImages: data.attachedImages ?? [],
        revisionStatus: data.revisionStatus ?? 'REQUESTED',
        warrantyExpiresAt: data.warrantyExpiresAt ?? defaultWarrentyExpiresAt,
      },
      include: { order: true },
    });
  }

  findAll() {
    return this.prisma.serviceRevision.findMany({
      orderBy: { createdAt: 'desc' },
      include: { order: true },
    });
  }

  findByOrder(orderId: string) {
    return this.prisma.serviceRevision.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      include: { order: true },
    });
  }

  async findOne(id: string) {
    const revision = await this.prisma.serviceRevision.findUnique({
      where: { id },
      include: { order: true },
    });

    if (!revision) throw new NotFoundException('Service revision not found');
    return revision;
  }

  async update(id: string, data: UpdateServiceRevisionDto) {
    await this.findOne(id);

    return this.prisma.serviceRevision.update({
      where: { id },
      data,
      include: { order: true },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.serviceRevision.delete({ where: { id } });
    return { message: 'Service revision deleted successfully' };
  }

  async postRevisionFeedback(id: string, continueWithProvider: boolean) {
    const revision = await this.prisma.serviceRevision.findUnique({
      where: { id },
      include: {
        order: true
      }
    })

    if (!revision) {
      throw new NotFoundException("Service Revision not found")
    }

    return this.prisma.$transaction(async (tx) => {
      const updateRevision = await tx.serviceRevision.update({
        where: { id },
        data: {
          revisionStatus: "COMPLETED"
        },
        include: { order: true }
      })
      if (!continueWithProvider) {
        await tx.activeChatSlot.updateMany({
          where: {
            providerId: revision.order.providerId,
            customerId: revision.order.customerId,
            status: { in: ["ACTIVE", "PAUSED"] }
          },
          data: {
            status: 'CLOSED'
          }
        })

        await tx.customerRetention.updateMany({
          where: {
            providerId: revision.order.providerId,
            customerId: revision.order.customerId,
          },
          data: {
            isChatActive: false,
            removedReason: 'Customer opted out after service revision'
          }
        })
      }
      return {
        message: continueWithProvider ? 'Feedback submitted . you cah continue chatting with this provider.' : 'Feedback submitted. Provider has been removed from your active chat ',
        revision: updateRevision
      }
    })
  }

  private async assertOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderStatus: true, updatedAt: true },
    });

    if (!order) throw new BadRequestException('Order not found');

    return order
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomOrderDto } from './dto/create-custom-order.dto';
import {
  UpdateOrderDto,
  UpdateOrderStatusDto,
} from './dto/update-order-status.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) { }

  async create(data: CreateCustomOrderDto) {
    await this.assertProvider(data.providerId);
    await this.assertCustomer(data.customerId);
    await this.assertService(data.serviceId);
    await this.assertTechnician(data.technicianId);

    const prices = this.calculatePrices(data);

    return this.prisma.order.create({
      data: {
        providerId: data.providerId,
        customerId: data.customerId,
        technicianId: data.technicianId,
        serviceId: data.serviceId,
        ...prices,
      },
      include: this.includeRelations(),
    });
  }

  findAll() {
    return this.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  findByProvider(providerId: string) {
    return this.prisma.order.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  findByCustomer(customerId: string) {
    return this.prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: this.includeRelations(),
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: this.includeRelations(),
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return order;
  }

  async update(id: string, data: UpdateOrderDto) {
    const order = await this.findOne(id);
    await this.assertTechnician(data.technicianId);

    const isPriceEdited = data.originalPrice !== undefined ||
      data.adminCommission !== undefined ||
      data.additionalPrice !== undefined;

    if (isPriceEdited && order.priceEditCount >= 2) {
      throw new BadRequestException("Price can only be modified a maximum of 2 times!")
    }

    const originalPrice = data.originalPrice ?? Number(order.originalPrice);
    const adminCommission =
      data.adminCommission ?? Number(order.adminCommission);
    const additionalPrice =
      data.additionalPrice ?? Number(order.additionalPrice);
    const advancePaid = data.advancePaid ?? Number(order.advancePaid);

    const prices = this.calculatePrices({
      originalPrice,
      adminCommission,
      additionalPrice,
      advancePaid,
    });

    return this.prisma.order.update({
      where: { id },
      data: {
        technicianId: data.technicianId,
        orderStatus: data.orderStatus,
        paymentStatus: data.paymentStatus,
        ...prices,
        priceEditCount:
          data.originalPrice !== undefined ||
            data.adminCommission !== undefined ||
            data.additionalPrice !== undefined
            ? { increment: 1 }
            : undefined,
      },
      include: this.includeRelations(),
    });
  }

  async updateStatus(id: string, data: UpdateOrderStatusDto) {
    await this.findOne(id);

    return this.prisma.order.update({
      where: { id },
      data,
      include: this.includeRelations(),
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.order.delete({
      where: { id },
    });

    return { message: 'Order deleted successfully' };
  }

  async acceptPrice(id: string) {
    const order = await this.findOne(id)

    return this.prisma.order.update({
      where: { id },
      data: {
        orderStatus: 'IN_PROGRESS'
      },
      include: this.includeRelations()
    })
  }


  async rejectPrice(id:string){
    const order = await this.findOne(id)

    const originalPrice=Number(order.originalPrice)
    const adminCommission=Number(order.adminCommission)
    const advancePaid=Number(order.advancePaid)

    const prices=this.calculatePrices({
      originalPrice,
      adminCommission,
      additionalPrice:0,
      advancePaid
    })

    return this.prisma.order.update({
      where:{id},
      data:{
        ...prices
      },
      include:this.includeRelations()
    })
  }


  private calculatePrices(data: {
    originalPrice: number;
    adminCommission?: number;
    additionalPrice?: number;
    advancePaid?: number;
  }) {
    const originalPrice = data.originalPrice;
    const adminCommission = data.adminCommission ?? 0;
    const additionalPrice = data.additionalPrice ?? 0;
    const advancePaid = data.advancePaid ?? 0;
    const totalPrice = originalPrice + adminCommission + additionalPrice;
    const dueAmount = totalPrice - advancePaid;

    if (advancePaid > totalPrice) {
      throw new BadRequestException('Advance paid cannot exceed total price');
    }

    return {
      originalPrice,
      adminCommission,
      additionalPrice,
      totalPrice,
      advancePaid,
      dueAmount,
    };
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
      technician: {
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
      paymentAndTip: true,
      revisions: true,
      providerReview: true,
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

  private async assertTechnician(technicianId?: string) {
    if (!technicianId) return;

    const technician = await this.prisma.technicianProfile.findUnique({
      where: { id: technicianId },
      select: { id: true },
    });

    if (!technician) {
      throw new BadRequestException('Technician profile not found');
    }
  }
}

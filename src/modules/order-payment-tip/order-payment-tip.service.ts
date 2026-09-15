import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateOrderPaymentTipDto,
  UpdateOrderPaymentTipDto,
} from './dto/order-payment-tip.dto';

@Injectable()
export class OrderPaymentTipService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateOrderPaymentTipDto) {
    const order = await this.assertOrder(data.orderId);
    const serviceAmountPaid = data.serviceAmountPaid ?? 0;
    const tipAmount = data.tipAmount ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.orderPaymentAndTip.upsert({
        where: { orderId: data.orderId },
        update: {
          paymentMode: data.paymentMode,
          serviceAmountPaid,
          tipAmount,
          hasTip: data.hasTip ?? tipAmount > 0,
          confirmationStatus: data.confirmationStatus,
          confirmationDeadline: data.confirmationDeadline,
          customerConfirmedAt: data.customerConfirmedAt,
          disputeReason: data.disputeReason,
          varianceFlag: data.varianceFlag ?? false,
          isGuestOrder: data.isGuestOrder ?? false,
          completedByPartner: data.completedByPartner ?? false,
        },
        create: {
          orderId: data.orderId,
          paymentMode: data.paymentMode,
          serviceAmountPaid,
          tipAmount,
          hasTip: data.hasTip ?? tipAmount > 0,
          confirmationStatus: data.confirmationStatus,
          confirmationDeadline: data.confirmationDeadline,
          customerConfirmedAt: data.customerConfirmedAt,
          disputeReason: data.disputeReason,
          varianceFlag: data.varianceFlag ?? false,
          isGuestOrder: data.isGuestOrder ?? false,
          completedByPartner: data.completedByPartner ?? false,
        },
        include: {
          order: true,
        },
      });

      await this.syncOrderPayment(
        tx,
        order.id,
        Number(order.totalPrice),
        serviceAmountPaid,
      );

      return payment;
    });
  }

  findAll() {
    return this.prisma.orderPaymentAndTip.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        order: true,
      },
    });
  }

  async findOne(id: string) {
    const payment = await this.prisma.orderPaymentAndTip.findUnique({
      where: { id },
      include: {
        order: true,
      },
    });

    if (!payment) {
      throw new NotFoundException('Order payment and tip not found');
    }

    return payment;
  }

  async findByOrder(orderId: string) {
    await this.assertOrder(orderId);

    return this.prisma.orderPaymentAndTip.findUnique({
      where: { orderId },
      include: {
        order: true,
      },
    });
  }

  async update(id: string, data: UpdateOrderPaymentTipDto) {
    const existing = await this.findOne(id);
    const serviceAmountPaid =
      data.serviceAmountPaid ?? Number(existing.serviceAmountPaid);

    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.orderPaymentAndTip.update({
        where: { id },
        data: {
          ...data,
          hasTip:
            data.hasTip ??
            (data.tipAmount !== undefined ? data.tipAmount > 0 : undefined),
        },
        include: {
          order: true,
        },
      });

      await this.syncOrderPayment(
        tx,
        existing.orderId,
        Number(existing.order.totalPrice),
        serviceAmountPaid,
      );

      return payment;
    });
  }

  async confirm(id: string) {
    await this.findOne(id);

    return this.prisma.orderPaymentAndTip.update({
      where: { id },
      data: {
        confirmationStatus: 'CONFIRMED',
        customerConfirmedAt: new Date(),
      },
      include: {
        order: true,
      },
    });
  }

  async dispute(id: string, disputeReason?: string) {
    if (!disputeReason?.trim()) {
      throw new BadRequestException('Dispute reason is required');
    }

    await this.findOne(id);

    return this.prisma.orderPaymentAndTip.update({
      where: { id },
      data: {
        confirmationStatus: 'DISPUTED',
        disputeReason,
        varianceFlag: true,
      },
      include: {
        order: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);

    await this.prisma.orderPaymentAndTip.delete({
      where: { id },
    });

    return { message: 'Order payment and tip deleted successfully' };
  }

  private async assertOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, totalPrice: true },
    });

    if (!order) {
      throw new BadRequestException('Order not found');
    }

    return order;
  }

  private async syncOrderPayment(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    orderId: string,
    totalPrice: number,
    serviceAmountPaid: number,
  ) {
    if (serviceAmountPaid > totalPrice) {
      throw new BadRequestException(
        'Service amount paid cannot exceed order total price',
      );
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        advancePaid: serviceAmountPaid,
        dueAmount: totalPrice - serviceAmountPaid,
        paymentStatus:
          serviceAmountPaid === 0
            ? 'UNPAID'
            : serviceAmountPaid >= totalPrice
              ? 'PAID'
              : 'PARTIAL',
      },
    });
  }
}

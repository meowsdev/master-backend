import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ExtraChargeStatus, OrderStatus, UserRole } from '@prisma/client';
import { assertNoPhoneNumber } from '../../common/contact-privacy';
import { COMMISSION_RATE } from '../orders/orders.helpers';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExtraChargeDto } from './dto/create-extra-charge.dto';
import { isOrderStaff } from '../auth/role-policy';

type Actor = { id: string; role: UserRole };

/** Per the provider rules, the price may be changed at most twice per order. */
export const MAX_APPROVED_EXTRA_CHARGES = 2;

const ORDER_PARTIES_SELECT = {
  id: true,
  orderStatus: true,
  totalPrice: true,
  priceEditCount: true,
  customer: { select: { userId: true } },
  provider: { select: { userId: true } },
  technician: { select: { userId: true } },
} as const;

@Injectable()
export class OrderExtraChargeService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: ORDER_PARTIES_SELECT });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async request(orderId: string, dto: CreateExtraChargeDto, actor: Actor) {
    const order = await this.loadOrder(orderId);

    const isWorkingOnOrder = order.provider.userId === actor.id || order.technician?.userId === actor.id;
    if (!isWorkingOnOrder) throw new ForbiddenException('Only the provider handling this order can add extra charges');
    if (order.orderStatus !== OrderStatus.IN_PROGRESS) {
      throw new BadRequestException('Extra charges can only be added while the work is in progress');
    }
    if (order.priceEditCount >= MAX_APPROVED_EXTRA_CHARGES) {
      throw new BadRequestException(`The price can be changed at most ${MAX_APPROVED_EXTRA_CHARGES} times`);
    }

    const payment = await this.prisma.orderPaymentAndTip.findUnique({ where: { orderId }, select: { paymentMode: true } });
    if (payment?.paymentMode === 'ONLINE') throw new BadRequestException('The work is finished and waiting for payment');

    const pending = await this.prisma.extraChargeRequest.findFirst({ where: { orderId, status: ExtraChargeStatus.PENDING } });
    if (pending) throw new ConflictException('The customer has not answered your previous extra-charge request yet');

    // The customer reads these labels, so they cannot carry the provider's phone number.
    dto.items.forEach((item) => assertNoPhoneNumber(item.label));

    const items = dto.items.map(({ label, amount }) => ({ label: label.trim(), amount }));
    const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

    return this.prisma.extraChargeRequest.create({
      data: { orderId, requestedById: actor.id, items, totalAmount, previousTotal: order.totalPrice },
    });
  }

  async list(orderId: string, actor: Actor) {
    const order = await this.loadOrder(orderId);
    // Reading is open to the order's parties and to staff; answering stays with the customer only.
    const isParty = [order.customer.userId, order.provider.userId, order.technician?.userId].includes(actor.id);
    if (!isParty && !isOrderStaff(actor.role)) throw new ForbiddenException('You are not part of this order');

    return this.prisma.extraChargeRequest.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  /** Only the order's customer answers. Approval and the price change happen in one transaction. */
  async respond(requestId: string, decision: 'APPROVED' | 'REJECTED', actor: Actor) {
    const request = await this.prisma.extraChargeRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Extra-charge request not found');

    const order = await this.loadOrder(request.orderId);
    if (order.customer.userId !== actor.id) throw new ForbiddenException('Only the customer of this order can answer');
    if (order.orderStatus !== OrderStatus.IN_PROGRESS) throw new BadRequestException('This order is no longer in progress');

    return this.prisma.$transaction(async (tx) => {
      // updateMany with the PENDING guard makes a double tap (or two tabs) apply the charge once.
      const claimed = await tx.extraChargeRequest.updateMany({
        where: { id: requestId, status: ExtraChargeStatus.PENDING },
        data: { status: decision, respondedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException('This request was already answered');

      if (decision === 'APPROVED') {
        await tx.order.update({
          where: { id: order.id },
          data: {
            // The platform's share grows with the job: approved extra work is commissioned like the rest.
            adminCommission: { increment: Math.round(Number(request.totalAmount) * COMMISSION_RATE) },
            additionalPrice: { increment: request.totalAmount },
            totalPrice: { increment: request.totalAmount },
            dueAmount: { increment: request.totalAmount },
            priceEditCount: { increment: 1 },
          },
        });
      }
      return tx.extraChargeRequest.findUniqueOrThrow({ where: { id: requestId } });
    });
  }
}

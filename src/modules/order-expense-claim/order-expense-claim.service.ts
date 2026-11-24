import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ExpenseClaimStatus, Prisma, RevisionStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isOrderStaff } from '../auth/role-policy';
import { ApproveExpenseClaimDto, ExpenseItemDto, SubmitExpenseClaimDto } from './dto/expense-claim.dto';

type Actor = { id: string; role: UserRole | string };

const sumOf = (items: ExpenseItemDto[]) => Math.round(items.reduce((total, item) => total + item.amount, 0) * 100) / 100;
const cleanItems = (items: ExpenseItemDto[]) => items.map(({ label, amount }) => ({ label: label.trim(), amount }));

/**
 * The platform commission once the job's costs are taken out. The order's own commission rate is kept
 * (10% by default, or whatever an admin set on the order), applied to (total - approved costs).
 */
export function commissionAfterExpenses(order: { totalPrice: number; adminCommission: number }, approvedExpenses: number): number {
  if (order.totalPrice <= 0) return 0;
  const rate = order.adminCommission / order.totalPrice;
  return Math.max(0, Math.round((order.totalPrice - approvedExpenses) * rate));
}

const ORDER_SELECT = {
  id: true,
  totalPrice: true,
  adminCommission: true,
  completedAt: true,
  providerId: true,
  provider: { select: { userId: true } },
  technician: { select: { userId: true } },
  paymentAndTip: { select: { paymentMode: true } },
  revisions: { where: { revisionStatus: { in: [RevisionStatus.REQUESTED, RevisionStatus.ACCEPTED] } }, select: { id: true } },
} satisfies Prisma.OrderSelect;

/*
 * Parts and costs of a finished job. The provider (or their technician) sends what they spent; an admin
 * reviews it, may raise or lower each amount, and approves or rejects. On approval the order's commission
 * is worked out again on (total - approved costs). For a cash job the commission already sits in the
 * provider's due, so the difference is given back to their wallet.
 */
@Injectable()
export class OrderExpenseClaimService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async submit(orderId: string, dto: SubmitExpenseClaimDto, actor: Actor) {
    const order = await this.loadOrder(orderId);
    const isWorkingOnOrder = order.provider.userId === actor.id || order.technician?.userId === actor.id;
    if (!isWorkingOnOrder) throw new ForbiddenException('Only the provider or technician of this order can send its costs');
    if (!order.completedAt) throw new BadRequestException('Costs can be sent once the work is complete');
    // During a revision the job is reopened: parts found then are billed as an Extra Charge, not as costs.
    if (order.revisions.length > 0) throw new BadRequestException('Costs cannot be sent while a revision is open');

    const existing = await this.prisma.orderExpenseClaim.findFirst({
      where: { orderId, status: { in: [ExpenseClaimStatus.PENDING, ExpenseClaimStatus.APPROVED] } },
      select: { status: true },
    });
    if (existing?.status === ExpenseClaimStatus.PENDING) throw new ConflictException('Your costs are already waiting for admin review');
    if (existing?.status === ExpenseClaimStatus.APPROVED) throw new ConflictException('The costs of this order are already approved');

    const items = cleanItems(dto.items);
    if (items.some((item) => item.amount <= 0)) throw new BadRequestException('Every cost needs an amount');
    const claimedTotal = sumOf(items);
    if (claimedTotal > Number(order.totalPrice)) throw new BadRequestException('Costs cannot be more than the order total');

    return this.prisma.orderExpenseClaim.create({ data: { orderId, submittedById: actor.id, items, claimedTotal } });
  }

  /** The order's provider and technician, and staff. The customer never sees the provider's costs. */
  async list(orderId: string, actor: Actor) {
    const order = await this.loadOrder(orderId);
    const isWorkingOnOrder = order.provider.userId === actor.id || order.technician?.userId === actor.id;
    if (!isWorkingOnOrder && !isOrderStaff(actor.role)) throw new ForbiddenException('You are not part of this order');
    return this.prisma.orderExpenseClaim.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  }

  /** Admin (guarded in the controller): approve with the reviewed amounts; the commission is worked out again. */
  async approve(claimId: string, dto: ApproveExpenseClaimDto, actor: Actor) {
    const claim = await this.prisma.orderExpenseClaim.findUnique({ where: { id: claimId }, select: { id: true, orderId: true } });
    if (!claim) throw new NotFoundException('Expense claim not found');
    const order = await this.loadOrder(claim.orderId);

    const approvedItems = cleanItems(dto.items);
    const approvedTotal = sumOf(approvedItems);
    const totalPrice = Number(order.totalPrice);
    if (approvedTotal > totalPrice) throw new BadRequestException('Approved costs cannot be more than the order total');

    const commissionBefore = Number(order.adminCommission);
    const commissionAfter = commissionAfterExpenses({ totalPrice, adminCommission: commissionBefore }, approvedTotal);
    // Cash (or a job closed without a payment record): the commission was taken into the provider's due.
    // Online: since online money reaches the wallet (a WalletCredit), its commission leaves the wallet too.
    // An online job settled before that only had the platform keep the commission, so only the order changes.
    const paymentMode = order.paymentAndTip?.paymentMode;
    const wasChargedToWallet =
      !paymentMode || paymentMode === 'CASH' || (await this.prisma.walletCredit.count({ where: { orderId: order.id } })) > 0;

    return this.prisma.$transaction(async (tx) => {
      // The PENDING guard makes a double click (or two admins) apply the claim once.
      const claimed = await tx.orderExpenseClaim.updateMany({
        where: { id: claimId, status: ExpenseClaimStatus.PENDING },
        data: {
          status: ExpenseClaimStatus.APPROVED,
          approvedItems,
          approvedTotal,
          reviewNote: dto.note?.trim() || null,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          commissionBefore,
          commissionAfter,
        },
      });
      if (claimed.count === 0) throw new ConflictException('This claim was already reviewed');

      await tx.order.update({ where: { id: order.id }, data: { adminCommission: commissionAfter } });

      const refund = commissionBefore - commissionAfter;
      if (wasChargedToWallet && refund !== 0) {
        const wallet = await tx.providerProfile.update({
          where: { id: order.providerId },
          data: { walletBalance: { increment: refund } },
          select: { walletBalance: true },
        });
        const isNegative = Number(wallet.walletBalance) < 0;
        await tx.providerProfile.update({ where: { id: order.providerId }, data: { isBlockedForNegative: isNegative, isAvailable: !isNegative } });
      }

      return tx.orderExpenseClaim.findUniqueOrThrow({ where: { id: claimId } });
    });
  }

  /** Admin (guarded in the controller): turn it down; the provider may send corrected costs. */
  async reject(claimId: string, note: string | undefined, actor: Actor) {
    const claimed = await this.prisma.orderExpenseClaim.updateMany({
      where: { id: claimId, status: ExpenseClaimStatus.PENDING },
      data: { status: ExpenseClaimStatus.REJECTED, reviewNote: note?.trim() || null, reviewedById: actor.id, reviewedAt: new Date() },
    });
    if (claimed.count === 0) throw new ConflictException('This claim was already reviewed or does not exist');
    return this.prisma.orderExpenseClaim.findUniqueOrThrow({ where: { id: claimId } });
  }
}

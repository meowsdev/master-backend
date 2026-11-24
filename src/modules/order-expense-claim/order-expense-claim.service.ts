import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ExpenseClaimStatus, ExtraChargeStatus, Prisma, RevisionStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isOrderStaff } from '../auth/role-policy';
import { commissionFor } from '../orders/orders.helpers';
import { ApproveExpenseClaimDto, ExpenseItemDto, SubmitExpenseClaimDto } from './dto/expense-claim.dto';

type Actor = { id: string; role: UserRole | string };

const sumOf = (items: ExpenseItemDto[]) => Math.round(items.reduce((total, item) => total + item.amount, 0) * 100) / 100;
const cleanItems = (items: ExpenseItemDto[]) => items.map(({ label, amount }) => ({ label: label.trim(), amount }));

/**
 * The platform commission once the job's costs are taken out: the order's commission percent (the provider's,
 * kept on the order when they got it) applied to the profit, (total - approved costs).
 * E.g. a ৳5000 job with ৳2000 of parts at 30%: 30% of ৳3000 = ৳900.
 */
export function commissionAfterExpenses(order: { totalPrice: number; commissionRate: number }, approvedExpenses: number): number {
  return commissionFor(Math.max(0, order.totalPrice - approvedExpenses), order.commissionRate);
}

const ORDER_SELECT = {
  id: true,
  totalPrice: true,
  adminCommission: true,
  commissionRate: true,
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

  /** Costs already approved on this order, all claims added up. */
  private async approvedCostsSoFar(orderId: string): Promise<number> {
    const result = await this.prisma.orderExpenseClaim.aggregate({ where: { orderId, status: ExpenseClaimStatus.APPROVED }, _sum: { approvedTotal: true } });
    return Number(result._sum.approvedTotal ?? 0);
  }

  /**
   * Why costs cannot be sent now, or null when they can. Costs are sent once per billing: after the job, and
   * again only when a revision billed extra work (an approved extra charge) after the last approval, so the
   * parts of that extra work are taken out of its commission the same way.
   */
  private async submitBlock(order: Awaited<ReturnType<OrderExpenseClaimService['loadOrder']>>): Promise<{ reason: string; isConflict: boolean } | null> {
    if (!order.completedAt) return { reason: 'Costs can be sent once the work is complete', isConflict: false };
    // During a revision the job is reopened: parts found then are billed as an Extra Charge, sent here once it is done.
    if (order.revisions.length > 0) return { reason: 'Costs cannot be sent while a revision is open', isConflict: false };

    const [pending, lastApproved] = await Promise.all([
      this.prisma.orderExpenseClaim.count({ where: { orderId: order.id, status: ExpenseClaimStatus.PENDING } }),
      this.prisma.orderExpenseClaim.findFirst({ where: { orderId: order.id, status: ExpenseClaimStatus.APPROVED }, orderBy: { reviewedAt: 'desc' }, select: { reviewedAt: true, createdAt: true } }),
    ]);
    if (pending > 0) return { reason: 'Your costs are already waiting for admin review', isConflict: true };
    if (lastApproved) {
      const billedSince = await this.prisma.extraChargeRequest.count({
        where: { orderId: order.id, status: ExtraChargeStatus.APPROVED, createdAt: { gt: lastApproved.reviewedAt ?? lastApproved.createdAt } },
      });
      if (billedSince === 0) return { reason: 'The costs of this order are already approved', isConflict: true };
    }
    return null;
  }

  /** For the app: whether the "send costs" button should show, and the costs approved so far. */
  async status(orderId: string, actor: Actor) {
    const order = await this.loadOrder(orderId);
    const isWorkingOnOrder = order.provider.userId === actor.id || order.technician?.userId === actor.id;
    if (!isWorkingOnOrder && !isOrderStaff(actor.role)) throw new ForbiddenException('You are not part of this order');
    const [block, approvedCosts] = await Promise.all([this.submitBlock(order), this.approvedCostsSoFar(orderId)]);
    return { canSubmit: block === null, reason: block?.reason ?? null, approvedCosts };
  }

  async submit(orderId: string, dto: SubmitExpenseClaimDto, actor: Actor) {
    const order = await this.loadOrder(orderId);
    const isWorkingOnOrder = order.provider.userId === actor.id || order.technician?.userId === actor.id;
    if (!isWorkingOnOrder) throw new ForbiddenException('Only the provider or technician of this order can send its costs');
    const block = await this.submitBlock(order);
    if (block) throw block.isConflict ? new ConflictException(block.reason) : new BadRequestException(block.reason);

    const items = cleanItems(dto.items);
    if (items.some((item) => item.amount <= 0)) throw new BadRequestException('Every cost needs an amount');
    const claimedTotal = sumOf(items);
    if ((await this.approvedCostsSoFar(orderId)) + claimedTotal > Number(order.totalPrice)) {
      throw new BadRequestException('Costs cannot be more than the order total');
    }

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
    // A second claim (parts of a revision's extra work) adds to the costs approved before it.
    const earlierCosts = await this.approvedCostsSoFar(order.id);
    if (earlierCosts + approvedTotal > totalPrice) throw new BadRequestException('Approved costs cannot be more than the order total');

    const commissionBefore = Number(order.adminCommission);
    // The whole bill (revision extras included) less every approved cost, at the order's percent.
    const commissionAfter = commissionAfterExpenses({ totalPrice, commissionRate: Number(order.commissionRate) }, earlierCosts + approvedTotal);
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

        // The commission given back is part of this order's online money, so it waits out the same clearance:
        // added to the order's credit that is still clearing. Without this it was withdrawable at once while the
        // rest of the order's money was still held. A credit already cleared leaves it withdrawable, as it should be.
        if (refund > 0) {
          const clearing = await tx.walletCredit.findFirst({
            where: { orderId: order.id, providerId: order.providerId, availableAt: { gt: new Date() } },
            orderBy: { availableAt: 'desc' },
            select: { id: true },
          });
          if (clearing) await tx.walletCredit.update({ where: { id: clearing.id }, data: { amount: { increment: refund } } });
        }
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

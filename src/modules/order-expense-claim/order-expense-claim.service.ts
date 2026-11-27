import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ExpenseClaimStatus, ExtraChargeStatus, Prisma, RevisionStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isOrderStaff } from '../auth/role-policy';
import { commissionFor } from '../orders/orders.helpers';
import { ApproveExpenseClaimDto, ExpenseItemDto, RejectExpenseClaimDto, SubmitExpenseClaimDto } from './dto/expense-claim.dto';

type Actor = { id: string; role: UserRole | string };

/** One step of a claim's journey, kept on the claim (`history`) so everyone sees who changed what. */
type ClaimStep = {
  action: 'SUBMITTED' | 'RESUBMITTED' | 'PROVIDER_ACCEPTED' | 'PROVIDER_RETURNED' | 'ADMIN_RETURNED' | 'ADMIN_APPROVED';
  byId: string;
  byRole: 'TECHNICIAN' | 'PROVIDER' | 'ADMIN';
  items: Array<{ label: string; amount: number }>;
  total: number;
  note: string | null;
  at: string;
};

/** A claim still in someone's hands: while one is open, no new claim can be sent for the order. */
const OPEN_STATUSES = [ExpenseClaimStatus.PENDING, ExpenseClaimStatus.PROVIDER_REVIEW, ExpenseClaimStatus.RETURNED_TO_TECHNICIAN];

const step = (action: ClaimStep['action'], actor: Actor, byRole: ClaimStep['byRole'], items: ClaimStep['items'], note?: string | null): ClaimStep => ({
  action,
  byId: actor.id,
  byRole,
  items,
  total: sumOf(items),
  note: note?.trim() || null,
  at: new Date().toISOString(),
});

const withStep = (history: Prisma.JsonValue, next: ClaimStep) => [...(Array.isArray(history) ? history : []), next] as unknown as Prisma.InputJsonValue;

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
 * Parts and costs of a finished job, passed hand to hand until an admin approves them:
 * - the technician sends → the provider reviews: changes the amounts and accepts (→ admin), or sends it back
 *   to the technician with a note, who changes it and sends it again (→ provider);
 * - the provider sends → straight to the admin;
 * - the admin approves (amounts may change) or sends it back to the provider (amounts may change too), who
 *   fixes it and accepts again, or passes it back to the technician.
 * On approval the order's commission is worked out again on (total - approved costs). For a cash job the
 * commission already sits in the provider's due, so the difference is given back to their wallet.
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
      this.prisma.orderExpenseClaim.count({ where: { orderId: order.id, status: { in: OPEN_STATUSES } } }),
      this.prisma.orderExpenseClaim.findFirst({ where: { orderId: order.id, status: ExpenseClaimStatus.APPROVED }, orderBy: { reviewedAt: 'desc' }, select: { reviewedAt: true, createdAt: true } }),
    ]);
    if (pending > 0) return { reason: 'The costs of this order are already being reviewed', isConflict: true };
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

  /** The technician's costs go to the provider first; the provider's go straight to an admin. */
  async submit(orderId: string, dto: SubmitExpenseClaimDto, actor: Actor) {
    const order = await this.loadOrder(orderId);
    const isProvider = order.provider.userId === actor.id;
    const isTechnician = !isProvider && order.technician?.userId === actor.id;
    if (!isProvider && !isTechnician) throw new ForbiddenException('Only the provider or technician of this order can send its costs');
    const block = await this.submitBlock(order);
    if (block) throw block.isConflict ? new ConflictException(block.reason) : new BadRequestException(block.reason);

    const items = cleanItems(dto.items);
    if (items.some((item) => item.amount <= 0)) throw new BadRequestException('Every cost needs an amount');
    const claimedTotal = sumOf(items);
    await this.assertWithinTotal(order, claimedTotal);

    return this.prisma.orderExpenseClaim.create({
      data: {
        orderId,
        submittedById: actor.id,
        items,
        claimedTotal,
        isFromTechnician: isTechnician,
        status: isTechnician ? ExpenseClaimStatus.PROVIDER_REVIEW : ExpenseClaimStatus.PENDING,
        history: [step('SUBMITTED', actor, isTechnician ? 'TECHNICIAN' : 'PROVIDER', items)] as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Costs (with those approved before) can never be more than the order's bill. */
  private async assertWithinTotal(order: { id: string; totalPrice: Prisma.Decimal | number }, costs: number) {
    if ((await this.approvedCostsSoFar(order.id)) + costs > Number(order.totalPrice)) {
      throw new BadRequestException('Costs cannot be more than the order total');
    }
  }

  private async loadClaim(claimId: string) {
    const claim = await this.prisma.orderExpenseClaim.findUnique({
      where: { id: claimId },
      select: { id: true, orderId: true, status: true, isFromTechnician: true, history: true, items: true },
    });
    if (!claim) throw new NotFoundException('Expense claim not found');
    return { claim, order: await this.loadOrder(claim.orderId) };
  }

  /** Moves a claim on only if it is still where the caller saw it, so a double click (or two people) applies a step once. */
  private async moveClaim(claimId: string, from: ExpenseClaimStatus, data: Prisma.OrderExpenseClaimUncheckedUpdateManyInput) {
    const moved = await this.prisma.orderExpenseClaim.updateMany({ where: { id: claimId, status: from }, data });
    if (moved.count === 0) throw new ConflictException('This claim has already moved on. Refresh and try again.');
    return this.prisma.orderExpenseClaim.findUniqueOrThrow({ where: { id: claimId } });
  }

  /** The order's provider: accept the costs (changed as they see fit) and send them to an admin. */
  async providerAccept(claimId: string, dto: ApproveExpenseClaimDto, actor: Actor) {
    const { claim, order } = await this.loadClaim(claimId);
    if (order.provider.userId !== actor.id) throw new ForbiddenException('Only the provider of this order can review its costs');
    if (claim.status !== ExpenseClaimStatus.PROVIDER_REVIEW) throw new ConflictException('These costs are not waiting for you');

    const items = cleanItems(dto.items);
    const total = sumOf(items);
    if (total <= 0) throw new BadRequestException('The costs need at least one amount');
    await this.assertWithinTotal(order, total);

    return this.moveClaim(claimId, ExpenseClaimStatus.PROVIDER_REVIEW, {
      status: ExpenseClaimStatus.PENDING,
      items,
      claimedTotal: total,
      providerNote: dto.note?.trim() || null,
      history: withStep(claim.history, step('PROVIDER_ACCEPTED', actor, 'PROVIDER', items, dto.note)),
    });
  }

  /** The order's provider: send the technician's costs back to them, with a note on what to fix. */
  async providerReturn(claimId: string, note: string | undefined, actor: Actor) {
    const { claim, order } = await this.loadClaim(claimId);
    if (order.provider.userId !== actor.id) throw new ForbiddenException('Only the provider of this order can review its costs');
    if (claim.status !== ExpenseClaimStatus.PROVIDER_REVIEW) throw new ConflictException('These costs are not waiting for you');
    if (!claim.isFromTechnician) throw new BadRequestException('You sent these costs yourself: change them and send them again');
    if (!order.technician) throw new BadRequestException('This order has no technician now to send the costs back to');

    return this.moveClaim(claimId, ExpenseClaimStatus.PROVIDER_REVIEW, {
      status: ExpenseClaimStatus.RETURNED_TO_TECHNICIAN,
      providerNote: note?.trim() || null,
      history: withStep(claim.history, step('PROVIDER_RETURNED', actor, 'PROVIDER', claim.items as ClaimStep['items'], note)),
    });
  }

  /** The order's technician: change the costs the provider sent back and send them to the provider again. */
  async resubmit(claimId: string, dto: SubmitExpenseClaimDto, actor: Actor) {
    const { claim, order } = await this.loadClaim(claimId);
    if (order.technician?.userId !== actor.id) throw new ForbiddenException('Only the technician of this order can send these costs again');
    if (claim.status !== ExpenseClaimStatus.RETURNED_TO_TECHNICIAN) throw new ConflictException('These costs were not sent back to you');

    const items = cleanItems(dto.items);
    if (items.some((item) => item.amount <= 0)) throw new BadRequestException('Every cost needs an amount');
    const total = sumOf(items);
    await this.assertWithinTotal(order, total);

    return this.moveClaim(claimId, ExpenseClaimStatus.RETURNED_TO_TECHNICIAN, {
      status: ExpenseClaimStatus.PROVIDER_REVIEW,
      items,
      claimedTotal: total,
      history: withStep(claim.history, step('RESUBMITTED', actor, 'TECHNICIAN', items)),
    });
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
    const { claim, order } = await this.loadClaim(claimId);

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
          history: withStep(claim.history, step('ADMIN_APPROVED', actor, 'ADMIN', approvedItems, dto.note)),
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

  /**
   * Admin (guarded in the controller): send it back to the provider, with a note and, if given, the amounts the
   * admin thinks are right. The provider fixes it and accepts again, or passes it back to the technician.
   */
  async reject(claimId: string, dto: RejectExpenseClaimDto, actor: Actor) {
    const { claim, order } = await this.loadClaim(claimId);
    if (claim.status !== ExpenseClaimStatus.PENDING) throw new ConflictException('This claim was already reviewed or does not exist');

    const suggested = dto.items ? cleanItems(dto.items) : null;
    if (suggested) await this.assertWithinTotal(order, sumOf(suggested));

    return this.moveClaim(claimId, ExpenseClaimStatus.PENDING, {
      status: ExpenseClaimStatus.PROVIDER_REVIEW,
      ...(suggested ? { items: suggested, claimedTotal: sumOf(suggested) } : {}),
      reviewNote: dto.note?.trim() || null,
      reviewedById: actor.id,
      reviewedAt: new Date(),
      history: withStep(claim.history, step('ADMIN_RETURNED', actor, 'ADMIN', suggested ?? (claim.items as ClaimStep['items']), dto.note)),
    });
  }
}

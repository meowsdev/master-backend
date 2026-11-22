import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { map } from 'rxjs';
import { isOrderChatOpen } from '../chat/order-chat-policy';
import { revisionDeadline } from '../service-revision/revision-window';

/** Stamp the moment an order is completed; it starts the revision window. Empty for other statuses. */
export function completionStamp(status?: OrderStatus | string) {
  return status === OrderStatus.COMPLETED ? { completedAt: new Date() } : {};
}

/** Stamp the moment a PENDING order is first taken (accepted or started). Empty for every other change. */
export function acceptanceStamp(currentStatus: OrderStatus | string, newStatus?: OrderStatus | string) {
  const isTaken = newStatus === OrderStatus.ACCEPTED || newStatus === OrderStatus.IN_PROGRESS;
  return currentStatus === OrderStatus.PENDING && isTaken ? { acceptedAt: new Date() } : {};
}

/**
 * A completed order the customer has not reviewed yet keeps its tab (so the payment result and
 * the review card stay visible) for as long as the warranty window lasts. Chat itself stays closed.
 */
export function isReviewPending(order: { orderStatus?: OrderStatus; providerReview?: unknown; completedAt?: Date | null }): boolean {
  if (order.orderStatus !== OrderStatus.COMPLETED || order.providerReview) return false;
  const deadline = revisionDeadline(order);
  return deadline !== null && Date.now() < deadline.getTime();
}

interface NamedUser {
  name?: string | null;
  username?: string | null;
  profilePhoto?: string | null;
  addresses?: Array<{ addressText: string }>;
}

interface AssigneeSource {
  technician?: { user?: NamedUser | null } | null;
  provider?: { companyName?: string | null; user?: NamedUser | null } | null;
}

export interface AssigneeLabels {
  /** "@hamid115", or null when no technician is assigned. */
  technician: string | null;
  /** Company name (it has priority) or else "@username"; null when no provider is known. */
  provider: string | null;
  /** The one name to show first: the technician, or with none the provider. */
  primary: string | null;
  /** "@manik05": the provider's username. */
  providerUsername: string | null;
  /** The provider's company name; their own name when they have no company. */
  providerName: string | null;
}

const NO_ASSIGNEE: AssigneeLabels = { technician: null, provider: null, primary: null, providerUsername: null, providerName: null };

/** An order counts as accepted once a provider took it; before that nobody's name is shown. */
export function isOrderAccepted(order: { orderStatus?: OrderStatus; acceptedAt?: Date | null }): boolean {
  if (order.acceptedAt) return true;
  const status = order.orderStatus;
  return status === OrderStatus.ACCEPTED || status === OrderStatus.IN_PROGRESS || status === OrderStatus.COMPLETED || status === OrderStatus.DISPUTED;
}

export function buildAssigneeLabels(order: AssigneeSource, isAccepted = true): AssigneeLabels {
  // The customer sees only the order id until a provider accepts.
  if (!isAccepted) return NO_ASSIGNEE;

  const technicianUsername = order.technician?.user?.username;
  const technician = technicianUsername ? `@${technicianUsername}` : null;

  const company = order.provider?.companyName?.trim();
  const providerUsername = order.provider?.user?.username;
  const provider = company || (providerUsername ? `@${providerUsername}` : null);

  const providerName = company || order.provider?.user?.name?.trim() || null;

  return {
    technician,
    provider,
    primary: technician ?? provider,
    providerUsername: providerUsername ? `@${providerUsername}` : null,
    providerName,
  };
}

/** Shown on the customer's order tab once a provider has accepted: who is coming, and from where. */
export interface AssignmentCard {
  /** TECHNICIAN when one is assigned, otherwise the provider handles the job personally. */
  role: 'TECHNICIAN' | 'PROVIDER';
  name: string | null;
  photoUrl: string | null;
  workshopAddress: string | null;
  shopName: string | null;
}

/** Only customers-safe fields: no phone numbers, wallet or KYC. Null until the order is accepted. */
export function buildAssignmentCard(order: AssigneeSource & { orderStatus?: OrderStatus }): AssignmentCard | null {
  const isAccepted = order.orderStatus && order.orderStatus !== OrderStatus.PENDING && order.orderStatus !== OrderStatus.CANCELLED;
  if (!isAccepted) return null;

  const technicianUser = order.technician?.user;
  const providerUser = order.provider?.user;
  const worker = technicianUser ?? providerUser;
  if (!worker) return null;

  return {
    role: technicianUser ? 'TECHNICIAN' : 'PROVIDER',
    name: worker.name ?? worker.username ?? null,
    photoUrl: worker.profilePhoto ?? providerUser?.profilePhoto ?? null,
    workshopAddress: providerUser?.addresses?.[0]?.addressText ?? null,
    shopName: order.provider?.companyName?.trim() || null,
  };
}

type OrderLike = AssigneeSource & { orderStatus?: OrderStatus; providerReview?: unknown; completedAt?: Date | null; acceptedAt?: Date | null } & Partial<Parameters<typeof isOrderChatOpen>[0]>;

const addOrderView = <T extends object>(order: T) => {
  const source = order as OrderLike;
  return {
    ...order,
    assignee: buildAssigneeLabels(source, isOrderAccepted(source)),
    assignmentCard: buildAssignmentCard(source),
    // Needs orderStatus + revisions; list endpoints include both.
    // False while the order is only offered to providers: the provider on the row is a stand-in until someone accepts.
    isAccepted: isOrderAccepted(source),
    isReviewPending: isReviewPending(source),
    isChatOpen: source.orderStatus && source.revisions ? isOrderChatOpen({ orderStatus: source.orderStatus, revisions: source.revisions }) : undefined,
    /** Last moment the customer (or an admin) may send it back for revision: 7 days after completion. */
    revisionDeadline: revisionDeadline(source)?.toISOString() ?? null,
    /** False when the customer has not verified their number by OTP: the provider can only take cash. */
    canPayOnline: customerCanPayOnline(order as Parameters<typeof customerCanPayOnline>[0]),
  };
};

/** Unknown (the customer was not loaded) counts as yes; the completion endpoint checks again. */
const customerCanPayOnline = (order: { customer?: { user?: { isVerified?: boolean | null } | null } | null }) =>
  order.customer?.user?.isVerified !== false;

/** Adds `assignee` names and `isChatOpen` to every order the orders endpoints return (one order or a list). */
@Injectable()
export class OrderViewInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((body: unknown) => {
        if (Array.isArray(body)) return body.map((item) => (item && typeof item === 'object' ? addOrderView(item) : item));
        return body && typeof body === 'object' && 'referenceCode' in body ? addOrderView(body) : body;
      }),
    );
  }
}

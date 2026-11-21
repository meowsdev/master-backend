import { OrderStatus, RevisionStatus, UserRole } from '@prisma/client';

/**
 * There is no "General Chat" any more: customers, providers and technicians only talk inside an order's
 * tab. Anything else they need goes to the Support chat. Staff (counselors, admins) may still write to a
 * conversation as a whole.
 */
const ROLES_BOUND_TO_AN_ORDER: UserRole[] = [UserRole.CUSTOMER, UserRole.PROVIDER, UserRole.TECHNICIAN];
export const mustChatInsideAnOrder = (role: string) => ROLES_BOUND_TO_AN_ORDER.includes(role as UserRole);

export interface OrderChatState {
  orderStatus: OrderStatus;
  revisions: Array<{ revisionStatus: RevisionStatus }>;
}

/** PENDING is left out: until a provider accepts, the provider on the order is only a stand-in, so nobody chats yet. */
const LIVE_STATUSES: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS];
const OPEN_REVISION_STATUSES: RevisionStatus[] = [RevisionStatus.REQUESTED, RevisionStatus.ACCEPTED];

/**
 * Whether an order's chat tab accepts messages.
 *
 * - A pending order (not accepted yet) is closed: the chat starts once a provider accepts.
 * - A running order (accepted / in progress) is open.
 * - Once COMPLETED the tab closes and the order only lives in order history ...
 * - ... until the customer asks for a revision. A revision can only be filed within
 *   3 days of completion (enforced in ServiceRevisionService), and it reopens the
 *   tab until the order is completed again.
 */
export function isOrderChatOpen(order: OrderChatState): boolean {
  if (LIVE_STATUSES.includes(order.orderStatus)) return true;
  return (
    order.orderStatus === OrderStatus.COMPLETED &&
    order.revisions.some((revision) => OPEN_REVISION_STATUSES.includes(revision.revisionStatus))
  );
}

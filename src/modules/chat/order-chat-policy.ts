import { OrderStatus, RevisionStatus } from '@prisma/client';

export interface OrderChatState {
  orderStatus: OrderStatus;
  revisions: Array<{ revisionStatus: RevisionStatus }>;
}

const LIVE_STATUSES: OrderStatus[] = [OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS];
const OPEN_REVISION_STATUSES: RevisionStatus[] = [RevisionStatus.REQUESTED, RevisionStatus.ACCEPTED];

/**
 * Whether an order's chat tab accepts messages.
 *
 * - A running order (pending / accepted / in progress) is open.
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

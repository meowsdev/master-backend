import { OrderStatus, RevisionStatus } from '@prisma/client';
import { isOrderChatOpen } from './order-chat-policy';

const order = (orderStatus: OrderStatus, ...revisions: RevisionStatus[]) => ({
  orderStatus,
  revisions: revisions.map((revisionStatus) => ({ revisionStatus })),
});

describe('isOrderChatOpen', () => {
  it.each([OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS])('is open while %s', (status) => {
    expect(isOrderChatOpen(order(status))).toBe(true);
  });

  it('closes once completed', () => {
    expect(isOrderChatOpen(order(OrderStatus.COMPLETED))).toBe(false);
  });

  it('stays closed after a rejected or finished revision', () => {
    expect(isOrderChatOpen(order(OrderStatus.COMPLETED, RevisionStatus.REJECTED, RevisionStatus.COMPLETED))).toBe(false);
  });

  it('reopens for a requested or accepted revision', () => {
    expect(isOrderChatOpen(order(OrderStatus.COMPLETED, RevisionStatus.REQUESTED))).toBe(true);
    expect(isOrderChatOpen(order(OrderStatus.COMPLETED, RevisionStatus.ACCEPTED))).toBe(true);
  });

  it('is closed for cancelled orders', () => {
    expect(isOrderChatOpen(order(OrderStatus.CANCELLED))).toBe(false);
  });
});

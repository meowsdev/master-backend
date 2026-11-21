import { OrderStatus, RevisionStatus } from '@prisma/client';
import { isOrderChatOpen, mustChatInsideAnOrder } from './order-chat-policy';

const order = (orderStatus: OrderStatus, ...revisions: RevisionStatus[]) => ({
  orderStatus,
  revisions: revisions.map((revisionStatus) => ({ revisionStatus })),
});

describe('isOrderChatOpen', () => {
  it.each([OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS])('is open while %s', (status) => {
    expect(isOrderChatOpen(order(status))).toBe(true);
  });

  it('stays closed until a provider accepts the order', () => {
    expect(isOrderChatOpen(order(OrderStatus.PENDING))).toBe(false);
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

describe('mustChatInsideAnOrder', () => {
  it('binds customers, providers and technicians to an order tab', () => {
    expect(mustChatInsideAnOrder('CUSTOMER')).toBe(true);
    expect(mustChatInsideAnOrder('PROVIDER')).toBe(true);
    expect(mustChatInsideAnOrder('TECHNICIAN')).toBe(true);
  });

  it('leaves staff free to write to a conversation', () => {
    expect(mustChatInsideAnOrder('COUNSELOR')).toBe(false);
    expect(mustChatInsideAnOrder('ADMIN')).toBe(false);
  });
});

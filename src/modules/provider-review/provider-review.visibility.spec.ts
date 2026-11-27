import { ProviderReviewService } from './provider-review.service';

/** One order of provider pp-1 by customer cp-1, and a transaction that records every write. */
function build() {
  const tx = {
    providerReview: {
      upsert: jest.fn().mockResolvedValue({ id: 'r1' }),
      update: jest
        .fn()
        .mockResolvedValue({ id: 'r1', isPublic: false, providerId: 'pp-1' }),
      aggregate: jest.fn().mockResolvedValue({ _avg: { customerRating: 3.5 } }),
    },
    providerProfile: { update: jest.fn() },
    activeChatSlot: { updateMany: jest.fn() },
    customerRetention: { updateMany: jest.fn() },
  };
  const prisma = {
    order: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'o1',
        providerId: 'pp-1',
        customerId: 'cp-1',
        orderStatus: 'COMPLETED',
      }),
    },
    providerProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: 'pp-1' }),
    },
    customerProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: 'cp-1' }),
    },
    providerReview: { findUnique: jest.fn().mockResolvedValue({ id: 'r1' }) },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  return { service: new ProviderReviewService(prisma as never), tx };
}

describe('a new review is public, whatever the stars', () => {
  it('publishes a 2-star review at once and counts it in the provider rating', async () => {
    const { service, tx } = build();
    await service.create({
      orderId: 'o1',
      providerId: 'pp-1',
      customerId: 'cp-1',
      customerRating: 2,
    });
    const [[upsert]] = tx.providerReview.upsert.mock.calls as [
      [{ create: Record<string, unknown> }],
    ];
    expect(upsert.create).toEqual(
      expect.objectContaining({ isPublic: true, moderationStatus: 'APPROVED' }),
    );
    expect(tx.providerProfile.update).toHaveBeenCalledWith({
      where: { id: 'pp-1' },
      data: { rating: 3.5 },
    });
  });
});

describe('an admin hiding or showing a review', () => {
  it('hides it and works the provider rating out again without it', async () => {
    const { service, tx } = build();
    await expect(service.setVisibility('r1', false)).resolves.toEqual({
      id: 'r1',
      isPublic: false,
    });
    expect(tx.providerReview.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: { isPublic: false },
      }),
    );
    expect(tx.providerProfile.update).toHaveBeenCalled();
  });

  it('shows it again as approved', async () => {
    const { service, tx } = build();
    tx.providerReview.update.mockResolvedValue({
      id: 'r1',
      isPublic: true,
      providerId: 'pp-1',
    });
    await service.setVisibility('r1', true);
    expect(tx.providerReview.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isPublic: true, moderationStatus: 'APPROVED' },
      }),
    );
  });
});

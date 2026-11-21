import { ForbiddenException } from '@nestjs/common';
import { ProviderReviewService } from './provider-review.service';

const reviewRow = { orderId: 'o-1', customerRating: 4, reviewComment: 'ভালো কাজ', createdAt: new Date('2026-11-01'), order: { referenceCode: 'A94K2B' }, customer: { user: { name: 'Rahim', username: null } } };
const ratingRow = { orderId: 'o-2', rating: 5, comment: null, createdAt: new Date('2026-11-02'), order: { referenceCode: 'B12C3D', provider: { companyName: 'Ali Care', user: { name: 'Ali', username: null } } } };

function build() {
  const prisma = {
    customerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'cp-1', rating: '4.50' }) },
    providerProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'pp-1', rating: '4.80' }) },
    customerRating: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([ratingRow]) },
    providerReview: {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([reviewRow]),
      aggregate: jest.fn().mockResolvedValue({ _avg: { customerRating: 4 }, _count: 1 }),
    },
  };
  return { service: new ProviderReviewService(prisma as never), prisma };
}

describe('ProviderReviewService.receivedBy', () => {
  it('gives a customer what providers said about them', async () => {
    const { service, prisma } = build();
    const result = await service.receivedBy({ id: 'u-c', role: 'CUSTOMER' });
    expect(prisma.customerRating.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { customerId: 'cp-1' } }));
    expect(result).toEqual({
      rating: 4.5,
      count: 1,
      reviews: [{ orderId: 'o-2', referenceCode: 'B12C3D', rating: 5, comment: null, createdAt: new Date('2026-11-02'), fromName: 'Ali Care' }],
    });
  });

  it("gives a provider the customers' reviews of their orders", async () => {
    const { service, prisma } = build();
    const result = await service.receivedBy({ id: 'u-p', role: 'PROVIDER' });
    expect(prisma.providerReview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { providerId: 'pp-1' } }));
    expect(result.rating).toBe(4.8);
    expect(result.reviews[0]).toMatchObject({ rating: 4, comment: 'ভালো কাজ', fromName: 'Rahim' });
  });

  it('gives a technician the reviews of the orders they did, with the average worked out', async () => {
    const { service, prisma } = build();
    const result = await service.receivedBy({ id: 'u-t', role: 'TECHNICIAN' });
    expect(prisma.providerReview.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { order: { technician: { userId: 'u-t' } } } }));
    expect(result).toMatchObject({ rating: 4, count: 1 });
  });

  it('refuses staff accounts', async () => {
    await expect(build().service.receivedBy({ id: 'u-a', role: 'ADMIN' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});

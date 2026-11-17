import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomerRatingService } from './customer-rating.service';

const PROVIDER = 'provider-user';

function build(orderStatus = 'COMPLETED', createError?: Error) {
  const tx = {
    customerRating: {
      create: jest.fn(() => (createError ? Promise.reject(createError) : Promise.resolve({ id: 'r1' }))),
      aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4.5 } }),
    },
    customerProfile: { update: jest.fn() },
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue({ id: 'o1', orderStatus, customerId: 'c1', provider: { userId: PROVIDER }, technician: null }) },
    customerRating: { findUnique: jest.fn() },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  return { service: new CustomerRatingService(prisma as never), tx };
}

describe('CustomerRatingService', () => {
  it('lets only the provider handling the order rate the customer', async () => {
    const { service } = build();
    await expect(service.rate('o1', { rating: 5 }, 'someone-else')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses before the order is completed', async () => {
    const { service } = build('IN_PROGRESS');
    await expect(service.rate('o1', { rating: 5 }, PROVIDER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("saves the rating and refreshes the customer's average", async () => {
    const { service, tx } = build();
    await service.rate('o1', { rating: 4, comment: ' polite ' }, PROVIDER);
    expect(tx.customerRating.create).toHaveBeenCalledWith({ data: expect.objectContaining({ rating: 4, comment: 'polite', customerId: 'c1' }) });
    expect(tx.customerProfile.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { rating: 4.5 } });
  });

  it('rejects a second rating for the same order', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    const { service } = build('COMPLETED', duplicate);
    await expect(service.rate('o1', { rating: 5 }, PROVIDER)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a phone number in the comment', async () => {
    const { service } = build();
    await expect(service.rate('o1', { rating: 5, comment: 'call 01711111111' }, PROVIDER)).rejects.toBeInstanceOf(BadRequestException);
  });
});

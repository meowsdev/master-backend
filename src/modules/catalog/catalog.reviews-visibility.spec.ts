import { CatalogService } from './catalog.service';

function build() {
  const prisma = {
    providerReview: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  return { service: new CatalogService(prisma as never), prisma };
}

describe('who sees a hidden review on a service page', () => {
  it('the public list only has public, approved reviews', async () => {
    const { service, prisma } = build();
    await service.getReviews({ categoryId: 'c1' });
    const [, [list]] = prisma.providerReview.findMany.mock.calls as [
      unknown,
      [{ where: Record<string, unknown> }],
    ];
    expect(list.where).toEqual(
      expect.objectContaining({ isPublic: true, moderationStatus: 'APPROVED' }),
    );
  });

  it("staff's list also has the hidden ones, while the star summary stays the public one", async () => {
    const { service, prisma } = build();
    await service.getReviews({ categoryId: 'c1' }, 1, 10, {
      includeHidden: true,
    });
    const [[summary], [list]] = prisma.providerReview.findMany.mock.calls as [
      [{ where: Record<string, unknown> }],
      [{ where: Record<string, unknown> }],
    ];
    expect(summary.where).toEqual(expect.objectContaining({ isPublic: true }));
    expect(list.where).not.toHaveProperty('isPublic');
  });
});

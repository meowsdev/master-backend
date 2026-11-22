import { Prisma, PrismaClient } from '@prisma/client';

type Client = PrismaClient | Prisma.TransactionClient;

/** Slug of each main service's hidden "Custom" sub-service. */
export const CUSTOM_SUB_SERVICE_SLUG = 'custom';

/**
 * The hidden "Custom" sub-service of a main service, created the first time a customer orders one. A customer's
 * custom order hangs off it so the order lands in that main service's chat as a tab. It is never listed as a card
 * (the app draws its own Custom card) and has no variants: the provider quotes a price after the site visit.
 */
export async function ensureCategoryCustomService(
  client: Client,
  categoryId: string,
): Promise<string> {
  const existing = await client.service.findFirst({
    where: { categoryId, isCustom: true },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await client.service.upsert({
    where: { categoryId_slug: { categoryId, slug: CUSTOM_SUB_SERVICE_SLUG } },
    update: { isCustom: true, isActive: true, isDeleted: false },
    create: {
      categoryId,
      slug: CUSTOM_SUB_SERVICE_SLUG,
      name: 'Custom request',
      nameBn: 'কাস্টম রিকোয়েস্ট',
      description:
        'Describe the problem; the provider visits and sends a price.',
      isCustom: true,
      basePrice: 0,
      sortOrder: -1,
    },
    select: { id: true },
  });
  return created.id;
}

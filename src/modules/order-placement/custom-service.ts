import { Prisma, PrismaClient } from '@prisma/client';

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * An admin's custom order (a service that is not in the catalog, typed by hand) still needs a service row,
 * because every order belongs to one. They all hang off this one hidden service. It is inactive, so it never
 * shows in the catalog, the customer's service list or a provider's service settings; the names the admin
 * typed live on the order's booking detail (customServiceName / subServiceName) and are shown instead.
 */
export const CUSTOM_SERVICE_SLUG = 'admin-custom-order';
const CUSTOM_CATEGORY_NAME = 'Custom (admin orders)';

let cachedId: string | null = null;

/** The hidden custom service's id, creating it (and its hidden main service) the first time. */
export async function ensureCustomService(client: Client): Promise<string> {
  if (cachedId) return cachedId;

  const category = await client.serviceCategory.upsert({
    where: { slug: CUSTOM_SERVICE_SLUG },
    update: {},
    create: { name: CUSTOM_CATEGORY_NAME, slug: CUSTOM_SERVICE_SLUG, isActive: false, description: 'Holds orders an admin created for a service not in the catalog.' },
    select: { id: true },
  });
  const existing = await client.service.findFirst({ where: { slug: CUSTOM_SERVICE_SLUG, categoryId: category.id }, select: { id: true } });
  const service =
    existing ??
    (await client.service.create({
      data: { categoryId: category.id, name: 'Custom service', nameBn: 'কাস্টম সার্ভিস', slug: CUSTOM_SERVICE_SLUG, isActive: false, basePrice: 0 },
      select: { id: true },
    }));

  cachedId = service.id;
  return service.id;
}

/** True for the hidden custom service: its orders go to every available provider in the area, whatever they offer. */
export async function isCustomServiceId(client: Client, serviceId: string): Promise<boolean> {
  if (cachedId) return serviceId === cachedId;
  const service = await client.service.findUnique({ where: { id: serviceId }, select: { slug: true } });
  if (service?.slug !== CUSTOM_SERVICE_SLUG) return false;
  cachedId = serviceId;
  return true;
}

/** For tests: forget the cached id. */
export function resetCustomServiceCache() {
  cachedId = null;
}

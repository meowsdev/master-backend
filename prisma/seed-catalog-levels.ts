/**
 * Demo catalog in four levels: Category (top bar) -> Main service (chat list) -> Sub-service (card) -> Variant.
 * Safe to repeat: everything is matched by slug / name and updated in place; nothing is deleted.
 *
 *   npx ts-node prisma/seed-catalog-levels.ts
 *   npx ts-node prisma/seed-catalog-levels.ts --assign-providers   (also switches every seeded sub-service on
 *                                                                    for each active provider, for local testing)
 */
import { PriceUnit, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface VariantSeed {
  name: string;
  price: number;
  originalPrice?: number;
  priceUnit?: PriceUnit;
}
interface SubSeed {
  name: string;
  nameBn?: string;
  description?: string;
  variants: VariantSeed[];
}
interface MainSeed {
  name: string;
  nameBn?: string;
  icon?: string;
  description?: string;
  included?: string[];
  excluded?: string[];
  details?: string;
  faqs?: Array<[string, string]>;
  subs: SubSeed[];
}
interface GroupSeed {
  name: string;
  nameBn: string;
  mains: MainSeed[];
}

const TON = (
  small: number,
  smallWas: number,
  big: number,
  bigWas: number,
): VariantSeed[] => [
  {
    name: '1 - 2.5 Ton',
    price: small,
    originalPrice: smallWas,
    priceUnit: PriceUnit.PER_UNIT,
  },
  {
    name: '3 - 5 Ton',
    price: big,
    originalPrice: bigWas,
    priceUnit: PriceUnit.PER_UNIT,
  },
];

const AC_FAQS: Array<[string, string]> = [
  [
    'Do I pay anything if I take no service?',
    'The visit is free. You only pay for the work you approve.',
  ],
  [
    'Do I pay in advance?',
    'No. You pay after the work is done, online or in cash.',
  ],
  ['Is this only for household ACs?', 'No, office ACs are covered too.'],
  [
    'Are parts included?',
    'No. Parts are charged separately at market price, and only after you approve them.',
  ],
];

const CATALOG: GroupSeed[] = [
  {
    name: 'AC Repair Services',
    nameBn: 'এসি রিপেয়ার',
    mains: [
      {
        name: 'AC Servicing',
        nameBn: 'এসি সার্ভিসিং',
        icon: '❄️',
        description: 'Checkup, cleaning and gas for split and window ACs.',
        included: ['Only service charge', '7 days service warranty'],
        excluded: [
          'Price of materials or parts',
          'Transport for new parts',
          'Hanging charge for the outdoor unit (if needed)',
        ],
        details:
          'Expert technicians check, clean and repair your AC at home. From a quick checkup to a full jet wash, every AC job in one place.',
        faqs: AC_FAQS,
        subs: [
          {
            name: 'AC Check Up',
            nameBn: 'এসি চেক আপ',
            description: 'Diagnosis of the problem by an expert technician.',
            variants: TON(299.63, 757.63, 482.5, 940.5),
          },
          {
            name: 'AC Gas Checkup Service',
            nameBn: 'এসি গ্যাস চেকআপ',
            description: 'Gas pressure check and refill if needed.',
            variants: TON(418, 600, 650, 900),
          },
          {
            name: 'AC Jet Wash',
            nameBn: 'এসি জেট ওয়াশ',
            description:
              'Indoor and outdoor units cleaned with a jet wash machine.',
            variants: TON(766.25, 1300, 1100, 1700),
          },
          {
            name: 'AC Basic Servicing',
            nameBn: 'এসি বেসিক সার্ভিসিং',
            description: 'Filter cleaning, test and problem identification.',
            variants: TON(550, 800, 750, 1000),
          },
        ],
      },
      {
        name: 'AC Doctor',
        nameBn: 'এসি ডক্টর',
        icon: '🩺',
        description: 'Repairs for ACs that are not cooling, leaking or noisy.',
        included: ['Only service charge', '7 days service warranty'],
        excluded: ['Price of materials or parts'],
        faqs: AC_FAQS,
        subs: [
          {
            name: 'AC Water Drop Solution',
            nameBn: 'এসি পানি পড়া সমাধান',
            variants: TON(650, 900, 850, 1100),
          },
          {
            name: 'AC Coil Change',
            nameBn: 'এসি কয়েল পরিবর্তন',
            variants: TON(1500, 2000, 2200, 2800),
          },
          {
            name: 'AC Capacitor Replacement',
            nameBn: 'এসি ক্যাপাসিটর পরিবর্তন',
            variants: [{ name: 'Standard', price: 450, originalPrice: 600 }],
          },
          {
            name: 'AC Outdoor Unit Change',
            nameBn: 'এসি আউটডোর পরিবর্তন',
            variants: [{ name: 'Standard', price: 1800 }],
          },
        ],
      },
      {
        name: 'AC Combo Packages',
        nameBn: 'এসি কম্বো প্যাকেজ',
        icon: '📦',
        description: 'Save more when you service several ACs together.',
        subs: [
          {
            name: 'AC Jet Wash (3 ACs)',
            nameBn: 'এসি জেট ওয়াশ (৩টি)',
            variants: [
              { name: '3 ACs', price: 2298.75, originalPrice: 3918.75 },
            ],
          },
          {
            name: 'AC Basic Servicing (2 ACs)',
            nameBn: 'এসি বেসিক সার্ভিসিং (২টি)',
            variants: [{ name: '2 ACs', price: 999, originalPrice: 1600 }],
          },
        ],
      },
    ],
  },
  {
    name: 'Appliance Repair',
    nameBn: 'অ্যাপ্লায়েন্স রিপেয়ার',
    mains: [
      {
        name: 'Refrigerator Repair',
        nameBn: 'ফ্রিজ রিপেয়ার',
        icon: '🧊',
        included: ['Only service charge', '7 days service warranty'],
        excluded: ['Price of materials or parts'],
        subs: [
          {
            name: 'Fridge Check Up',
            nameBn: 'ফ্রিজ চেক আপ',
            variants: [{ name: 'Standard', price: 300, originalPrice: 500 }],
          },
          {
            name: 'Fridge Gas Refill',
            nameBn: 'ফ্রিজ গ্যাস রিফিল',
            variants: [
              { name: 'Up to 300L', price: 1800 },
              { name: 'Above 300L', price: 2400 },
            ],
          },
        ],
      },
      {
        name: 'Microwave Oven Repair',
        nameBn: 'মাইক্রোওয়েভ ওভেন রিপেয়ার',
        icon: '🍲',
        subs: [
          {
            name: 'Oven Check Up',
            nameBn: 'ওভেন চেক আপ',
            variants: [{ name: 'Standard', price: 350 }],
          },
        ],
      },
      {
        name: 'Washing Machine Repair',
        nameBn: 'ওয়াশিং মেশিন রিপেয়ার',
        icon: '🫧',
        subs: [
          {
            name: 'Washing Machine Check Up',
            nameBn: 'ওয়াশিং মেশিন চেক আপ',
            variants: [{ name: 'Standard', price: 400 }],
          },
        ],
      },
    ],
  },
  {
    name: 'Cleaning Solution',
    nameBn: 'ক্লিনিং সলিউশন',
    mains: [
      {
        name: 'Home Deep Cleaning',
        nameBn: 'হোম ডিপ ক্লিনিং',
        icon: '🧹',
        subs: [
          {
            name: 'Full Home Deep Cleaning',
            nameBn: 'পুরো বাসা ডিপ ক্লিনিং',
            variants: [
              { name: 'Per sqft', price: 8, priceUnit: PriceUnit.PER_SQFT },
            ],
          },
          {
            name: 'Kitchen Deep Cleaning',
            nameBn: 'কিচেন ডিপ ক্লিনিং',
            variants: [{ name: 'Standard', price: 1500, originalPrice: 2000 }],
          },
          {
            name: 'Bathroom Cleaning',
            nameBn: 'বাথরুম ক্লিনিং',
            variants: [
              {
                name: 'Per bathroom',
                price: 700,
                priceUnit: PriceUnit.PER_UNIT,
              },
            ],
          },
        ],
      },
    ],
  },
];

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 110);

async function main() {
  const seededServiceIds: string[] = [];

  for (const [groupIndex, group] of CATALOG.entries()) {
    const groupRow = await prisma.serviceGroup.upsert({
      where: { slug: slugify(group.name) },
      update: { name: group.name, nameBn: group.nameBn, sortOrder: groupIndex },
      create: {
        name: group.name,
        nameBn: group.nameBn,
        slug: slugify(group.name),
        sortOrder: groupIndex,
      },
    });

    for (const [mainIndex, main] of group.mains.entries()) {
      const mainData = {
        name: main.name,
        groupId: groupRow.id,
        iconUrl: main.icon ?? null,
        description: main.description ?? null,
        included: main.included ?? [],
        excluded: main.excluded ?? [],
        details: main.details ?? null,
        sortOrder: mainIndex,
        isActive: true,
        isDeleted: false,
      };
      const mainRow = await prisma.serviceCategory.upsert({
        where: { slug: slugify(main.name) },
        update: mainData,
        create: { ...mainData, slug: slugify(main.name) },
      });

      if (main.faqs) {
        // FAQs have no natural key; the seed owns the main service's list, so it is rewritten.
        await prisma.serviceFaq.deleteMany({
          where: { categoryId: mainRow.id, serviceId: null },
        });
        await prisma.serviceFaq.createMany({
          data: main.faqs.map(([question, answer], sortOrder) => ({
            categoryId: mainRow.id,
            question,
            answer,
            sortOrder,
          })),
        });
      }

      for (const [subIndex, sub] of main.subs.entries()) {
        const lowest = Math.min(
          ...sub.variants.map((variant) => variant.price),
        );
        const subData = {
          name: sub.name,
          nameBn: sub.nameBn ?? null,
          description: sub.description ?? null,
          basePrice: lowest,
          priceUnit: sub.variants[0].priceUnit ?? PriceUnit.FIXED,
          sortOrder: subIndex,
          isActive: true,
          isDeleted: false,
        };
        const slug = slugify(sub.name);
        const subRow = await prisma.service.upsert({
          where: { categoryId_slug: { categoryId: mainRow.id, slug } },
          update: subData,
          create: { ...subData, slug, categoryId: mainRow.id },
        });
        seededServiceIds.push(subRow.id);

        for (const [variantIndex, variant] of sub.variants.entries()) {
          const existing = await prisma.serviceVariant.findFirst({
            where: { serviceId: subRow.id, name: variant.name },
          });
          const variantData = {
            price: variant.price,
            originalPrice: variant.originalPrice ?? null,
            priceUnit: variant.priceUnit ?? PriceUnit.FIXED,
            sortOrder: variantIndex,
            isActive: true,
            isDeleted: false,
          };
          if (existing)
            await prisma.serviceVariant.update({
              where: { id: existing.id },
              data: variantData,
            });
          else
            await prisma.serviceVariant.create({
              data: {
                ...variantData,
                serviceId: subRow.id,
                name: variant.name,
              },
            });
        }
      }
    }
    console.log(`Seeded ${group.name}`);
  }

  if (process.argv.includes('--assign-providers')) {
    const providers = await prisma.user.findMany({
      where: { role: 'PROVIDER', status: 'ACTIVE' },
      select: { id: true },
    });
    for (const provider of providers) {
      await prisma.serviceAssignee.createMany({
        data: seededServiceIds.map((serviceId) => ({
          userId: provider.id,
          serviceId,
        })),
        skipDuplicates: true,
      });
    }
    console.log(
      `Switched ${seededServiceIds.length} sub-services on for ${providers.length} providers`,
    );
  }
}

main().finally(() => prisma.$disconnect());

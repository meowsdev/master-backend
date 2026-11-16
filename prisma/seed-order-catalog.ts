/**
 * Starter data for the Place Order panel. Real prices, quantities and questions are
 * set by admins; these defaults only make the form usable.
 *
 * - Marks a few sub-services as PER_UNIT so the customer can pick a quantity.
 * - Adds the "hanging outdoor unit" follow-up question to the AC main service.
 * Safe to repeat.
 *
 *   npx ts-node prisma/seed-order-catalog.ts
 */
import { PrismaClient, PriceUnit } from '@prisma/client';

const prisma = new PrismaClient();

/** Sub-services where it makes sense to order several (2-5 ACs, fans, cameras). */
const PER_UNIT_SERVICES = [
  'Split AC Master Chemical Wash',
  'Ceiling Fan & Chandelier Hanging Setup',
  'CCTV Camera Installation & Cable Routing',
];

async function main() {
  const updated = await prisma.service.updateMany({
    where: { name: { in: PER_UNIT_SERVICES } },
    data: { priceUnit: PriceUnit.PER_UNIT },
  });
  console.log(`Marked ${updated.count} sub-services as PER_UNIT`);

  const ac = await prisma.serviceCategory.findFirst({ where: { name: 'AC Repair & Service' } });
  if (!ac) {
    console.warn('AC main service not found; skipped the question');
    return;
  }
  await prisma.serviceQuestion.deleteMany({ where: { categoryId: ac.id } });
  await prisma.serviceQuestion.create({
    data: {
      categoryId: ac.id,
      text: 'Is the outdoor unit hanging or in a risky place?',
      textBn: 'এসির আউটডোর ইউনিট কি ঝুলন্ত বা ঝুঁকিপূর্ণ স্থানে অবস্থিত?',
      options: {
        create: [
          { label: 'Yes', labelBn: 'হ্যাঁ', unitPrice: 300, isCountable: true, sortOrder: 0 },
          { label: 'No', labelBn: 'না', unitPrice: 0, isCountable: false, sortOrder: 1 },
        ],
      },
    },
  });
  console.log('Seeded the AC outdoor-unit question');
}

main().finally(() => prisma.$disconnect());

import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Setting up Demo Counselor and Provider accounts...');

  const counselorPhone = '+8801700000002';

  const counselorUser = await prisma.user.upsert({
    where: { mobileNumber: counselorPhone },
    update: {
      name: 'Master Support Counselor',
      email: 'counselor@master.com',
      role: UserRole.COUNSELOR,
      status: 'ACTIVE',
      isVerified: true,
    },
    create: {
      mobileNumber: counselorPhone,
      name: 'Master Support Counselor',
      email: 'counselor@master.com',
      role: UserRole.COUNSELOR,
      status: 'ACTIVE',
      isVerified: true,
    },
  });

  const counselorProfile = await prisma.counselorProfile.upsert({
    where: { userId: counselorUser.id },
    update: {
      isOnline: true,
      maxConcurrentLimit: 10,
    },
    create: {
      userId: counselorUser.id,
      isOnline: true,
      maxConcurrentLimit: 10,
    },
  });

  console.log(`✅ Counselor Account Ready!`);
  console.log(`📱 Mobile Number: ${counselorPhone} (or 01700000002)`);
  console.log(`👤 Name: ${counselorUser.name}`);
  console.log(`💼 Role: ${counselorUser.role}`);
  console.log(`🟢 Profile Online: ${counselorProfile.isOnline}`);
}

main()
  .catch((e) => {
    console.error('❌ Error setting up counselor:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient, UserRole, ProviderLevel } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Setting up Demo Provider Account...');

  const providerPhone = '+8801700000003';

  const providerUser = await prisma.user.upsert({
    where: { mobileNumber: providerPhone },
    update: {
      name: 'Master Expert Provider',
      email: 'provider@master.com',
      role: UserRole.PROVIDER,
      status: 'ACTIVE',
      isVerified: true,
    },
    create: {
      mobileNumber: providerPhone,
      name: 'Master Expert Provider',
      email: 'provider@master.com',
      role: UserRole.PROVIDER,
      status: 'ACTIVE',
      isVerified: true,
    },
  });

  const providerProfile = await prisma.providerProfile.upsert({
    where: { userId: providerUser.id },
    update: {
      bio: 'Certified Master HVAC, Electrical & Technical Service Provider with 5+ years experience.',
      rating: 4.9,
      totalCompletedOrders: 38,
      level: ProviderLevel.GOLD,
      experienceYears: 5,
      isAvailable: true,
      walletBalance: 5000.00,
      monthlyEarnings: 45000.00,
      isBlockedForNegative: false,
    },
    create: {
      userId: providerUser.id,
      bio: 'Certified Master HVAC, Electrical & Technical Service Provider with 5+ years experience.',
      rating: 4.9,
      totalCompletedOrders: 38,
      level: ProviderLevel.GOLD,
      experienceYears: 5,
      isAvailable: true,
      walletBalance: 5000.00,
      monthlyEarnings: 45000.00,
      isBlockedForNegative: false,
    },
  });

  // Assign this provider to recent orders so they can manage them in dashboard
  const updatedOrders = await prisma.order.updateMany({
    data: {
      providerId: providerProfile.id,
    },
  });

  console.log(`✅ Provider Account Ready!`);
  console.log(`📱 Mobile Number: ${providerPhone} (or 01700000003)`);
  console.log(`👤 Name: ${providerUser.name}`);
  console.log(`💼 Role: ${providerUser.role}`);
  console.log(`💰 Wallet Balance: ৳${providerProfile.walletBalance}`);
  console.log(`⭐ Rating: ${providerProfile.rating} (${providerProfile.level})`);
  console.log(`📦 Linked to ${updatedOrders.count} orders for testing`);
}

main()
  .catch((e) => {
    console.error('❌ Error setting up provider:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import slugify from 'slugify';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { CreateServiceDto, UpdateServiceDto } from './dto/service.dto';
import { DiscoverProvidersQueryDto } from './dto/discover-providers.dto';

@Injectable()
export class ServicesService {
  constructor(private readonly prisma: PrismaService) {}

  async createCategory(data: CreateCategoryDto) {
    // A Bengali-only name slugifies to nothing, so a short unique id stands in.
    const slug = data.slug || slugify(data.name, { lower: true, strict: true }) || `category-${Date.now().toString(36)}`;

    const existingCategory = await this.prisma.serviceCategory.findFirst({
      where: {
        OR: [
          {
            name: data.name,
          },
          {
            slug: slug,
          },
        ],
      },
    });

    if (existingCategory) {
      throw new BadRequestException('Category already exists');
    }

    return this.prisma.serviceCategory.create({
      data: { ...data, slug },
    });
  }

  async getAllCategory() {
    return this.prisma.serviceCategory.findMany({
      where: { isActive: true, isDeleted: false },
      include: {
        services: {
          where: { isActive: true, isDeleted: false, isCustom: false },
        },
        _count: { select: { services: true } },
      },
    });
  }

  async getSingleCategory(identifier: string) {
    const category = await this.prisma.serviceCategory.findFirst({
      where: {
        OR: [{ id: identifier }, { slug: identifier }],
        isDeleted: false,
        isActive: true,
      },
      include: {
        services: {
          where: { isActive: true, isDeleted: false, isCustom: false },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async updateSingleCategory(id: string, data: UpdateCategoryDto) {
    try {
      return await this.prisma.serviceCategory.update({
        where: {
          id,
        },
        data,
      });
    } catch (error) {
      // Main service names are unique: say so instead of failing with a server error.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Another main service already has this name');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('Main service not found');
      }
      throw error;
    }
  }

  async deleteSingleCategory(id: string) {
    return this.prisma.serviceCategory.update({
      where: {
        id,
      },
      data: {
        isDeleted: true,
      },
    });
  }

  async createService(data: CreateServiceDto) {
    // The live database requires a slug, unique inside the main service.
    const slug = slugify(data.name, { lower: true, strict: true });
    // Every sub-service starts with one priced option, so customers can add it to the cart right away;
    // admins add more options (sizes, tons) in the catalog editor.
    return this.prisma.service.create({
      data: {
        ...data,
        slug,
        variants: { create: { name: 'Standard', nameBn: 'স্ট্যান্ডার্ড', price: data.basePrice, priceUnit: data.priceUnit, durationMin: data.durationMin } },
      },
    });
  }

  async getAllServices(
    categoryId?: string,
    search?: string,
    isPopular?: boolean,
  ) {
    const services = await this.prisma.service.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        isCustom: false,
        ...(categoryId ? { categoryId } : {}),
        ...(isPopular !== undefined ? { isPopular } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                {
                  category: { name: { contains: search, mode: 'insensitive' } },
                },
              ],
            }
          : {}),
      },
      include: {
        category: true,
        // Only providers who can actually take orders for this service today
        serviceAssignments: {
          where: {
            isActive: true,
            user: {
              status: 'ACTIVE',
              providerProfile: { is: { isBlockedForNegative: false } },
            },
          },
          select: {
            user: {
              select: {
                name: true,
                providerProfile: { select: { rating: true } },
              },
            },
          },
        },
      },
      orderBy: [
        { isPopular: 'desc' },
        { orderCount: 'desc' },
        { createdAt: 'asc' },
      ],
    });

    return services.map(({ serviceAssignments, ...service }) =>
      this.attachProviderSummary(service, serviceAssignments),
    );
  }

  /**
   * Builds the lightweight provider preview shown in the customer chat list:
   * best-rated provider names first, plus the average of rated providers.
   * Unrated providers are left out of the average so a new service reads "New".
   */
  private attachProviderSummary<T extends object>(
    service: T,
    assignments: Array<{
      user: {
        name: string | null;
        providerProfile: { rating: unknown } | null;
      };
    }>,
  ) {
    const providers = assignments
      .map(({ user }) => ({
        name: user.name?.trim() || null,
        rating: Number(user.providerProfile?.rating ?? 0),
      }))
      .sort((a, b) => b.rating - a.rating);

    const ratedProviders = providers.filter((provider) => provider.rating > 0);
    const averageRating = ratedProviders.length
      ? Number(
          (
            ratedProviders.reduce((sum, provider) => sum + provider.rating, 0) /
            ratedProviders.length
          ).toFixed(1),
        )
      : null;

    return {
      ...service,
      providerSummary: {
        providerCount: providers.length,
        providerNames: providers
          .map((provider) => provider.name)
          .filter((name): name is string => Boolean(name))
          .slice(0, 3),
        averageRating,
      },
    };
  }

  async getSingleService(id: string) {
    const service = await this.prisma.service.findUnique({
      where: {
        id,
        isActive: true,
        isDeleted: false,
      },
      include: {
        category: true,
      },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return service;
  }

  async updateSingleService(id: string, data: UpdateServiceDto) {
    return this.prisma.service.update({
      where: { id },
      data,
    });
  }

  async deleteSingleService(id: string) {
    return this.prisma.service.update({
      where: {
        id,
      },
      data: {
        isDeleted: true,
      },
    });
  }

  async discoverProviders(query: DiscoverProvidersQueryDto) {
    const {
      serviceId,
      categoryId,
      latitude,
      longitude,
      radiusKm = 25,
      search,
    } = query;
    // ১. প্রোভাইডারদের ডাটাবেজ থেকে নিয়ে আসা
    const providers = await this.prisma.providerProfile.findMany({
      where: {
        isBlockedForNegative: false,
        user: {
          status: 'ACTIVE',
          name: search ? { contains: search, mode: 'insensitive' } : undefined,
          serviceAssignments: serviceId
            ? { some: { serviceId, isActive: true } }
            : categoryId
              ? { some: { service: { categoryId }, isActive: true } }
              : undefined,
        },
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            mobileNumber: true,
            profilePhoto: true,
            status: true,
            addresses: true,
          },
        },
        kyc: {
          select: { status: true },
        },
      },
    });
    // ২. যদি GPS লোকেশন দেওয়া থাকে, Haversine দিয়ে দূরত্ব হিসাব ও ফিল্টার করা
    let results = providers.map((provider) => {
      let distanceKm: number | null = null;
      if (latitude !== undefined && longitude !== undefined) {
        // প্রোভাইডারের ডিফল্ট বা প্রথম এড্রেসের কো-অর্ডিনেট নেওয়া
        const providerAddress =
          provider.user.addresses.find((a) => a.isDefault) ||
          provider.user.addresses[0];
        if (providerAddress?.latitude && providerAddress?.longitude) {
          distanceKm = this.calculateHaversineDistance(
            latitude,
            longitude,
            Number(providerAddress.latitude),
            Number(providerAddress.longitude),
          );
        }
      }
      return {
        ...provider,
        distanceKm: distanceKm !== null ? Number(distanceKm.toFixed(1)) : null,
      };
    });
    // ৩. রেডিয়াস ফিল্টারিং (যদি কাস্টমার লোকেশন দিয়ে থাকে এবং দূরত্ব রেডিয়াসের বাইরে হয়)
    if (latitude !== undefined && longitude !== undefined && radiusKm) {
      results = results.filter(
        (p) => p.distanceKm === null || p.distanceKm <= radiusKm,
      );
    }
    // ৪. PRD নিয়ম অনুযায়ী সাজানো: Rating (Highest first) ➔ Online status (Active first) ➔ Distance (Closest first)
    results.sort((a, b) => {
      // অনলাইন স্ট্যাটাস প্রায়োরিটি
      if (a.isAvailable !== b.isAvailable) {
        return a.isAvailable ? -1 : 1;
      }
      // রেটিং অনুযায়ী সর্ট
      const ratingDiff = Number(b.rating) - Number(a.rating);
      if (ratingDiff !== 0) return ratingDiff;
      // দূরত্ব অনুযায়ী সর্ট
      if (a.distanceKm !== null && b.distanceKm !== null) {
        return a.distanceKm - b.distanceKm;
      }
      return 0;
    });
    return results;
  }
  // Haversine ম্যাথমেটিক্যাল ফর্মুলা
  private calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // পৃথিবীর ব্যাসার্ধ (কিলোমিটারে)
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

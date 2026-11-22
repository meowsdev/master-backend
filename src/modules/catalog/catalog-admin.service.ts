import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PriceUnit } from '@prisma/client';
import slugify from 'slugify';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateFaqDto,
  CreateServiceGroupDto,
  CreateVariantDto,
  ReorderDto,
  UpdateFaqDto,
  UpdateMainServiceCatalogDto,
  UpdateServiceGroupDto,
  UpdateSubServiceCatalogDto,
  UpdateVariantDto,
} from './dto/catalog-admin.dto';

/** Admin writes for the four-level catalog. Deletes are soft, like the rest of the catalog. */
@Injectable()
export class CatalogAdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything the admin catalog editor shows, including inactive rows. */
  tree() {
    const notDeleted = { isDeleted: false };
    return this.prisma.serviceGroup.findMany({
      where: notDeleted,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        categories: {
          where: notDeleted,
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            faqs: { where: { serviceId: null }, orderBy: { sortOrder: 'asc' } },
            services: {
              where: { ...notDeleted, isCustom: false },
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              include: {
                variants: { where: notDeleted, orderBy: { sortOrder: 'asc' } },
                faqs: { orderBy: { sortOrder: 'asc' } },
              },
            },
          },
        },
      },
    });
  }

  /** Main services not yet placed in any category (made before categories existed). */
  ungroupedMainServices() {
    return this.prisma.serviceCategory.findMany({
      where: {
        isDeleted: false,
        groupId: null,
        slug: { not: 'admin-custom-order' },
      },
      orderBy: { name: 'asc' },
    });
  }

  async createGroup(dto: CreateServiceGroupDto) {
    const slug =
      slugify(dto.name, { lower: true, strict: true }) ||
      `category-${Date.now().toString(36)}`;
    const clash = await this.prisma.serviceGroup.findFirst({
      where: { OR: [{ name: dto.name.trim() }, { slug }] },
    });
    if (clash)
      throw new BadRequestException('A category with this name already exists');
    return this.prisma.serviceGroup.create({
      data: { ...dto, name: dto.name.trim(), slug },
    });
  }

  async updateGroup(id: string, dto: UpdateServiceGroupDto) {
    await this.mustExist('group', id);
    return this.prisma.serviceGroup.update({ where: { id }, data: dto });
  }

  async deleteGroup(id: string) {
    await this.mustExist('group', id);
    const live = await this.prisma.serviceCategory.count({
      where: { groupId: id, isDeleted: false },
    });
    if (live > 0)
      throw new BadRequestException('Move or delete its main services first');
    return this.prisma.serviceGroup.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });
  }

  async updateMainService(id: string, dto: UpdateMainServiceCatalogDto) {
    await this.mustExist('mainService', id);
    if (dto.groupId) await this.mustExist('group', dto.groupId);
    return this.prisma.serviceCategory.update({ where: { id }, data: dto });
  }

  async updateSubService(id: string, dto: UpdateSubServiceCatalogDto) {
    await this.mustExist('subService', id);
    return this.prisma.service.update({ where: { id }, data: dto });
  }

  async createVariant(dto: CreateVariantDto) {
    await this.mustExist('subService', dto.serviceId);
    this.assertDiscount(dto.price, dto.originalPrice);
    const variant = await this.prisma.serviceVariant.create({ data: dto });
    await this.syncBasePrice(dto.serviceId);
    return variant;
  }

  async updateVariant(id: string, dto: UpdateVariantDto) {
    const current = await this.prisma.serviceVariant.findFirst({
      where: { id, isDeleted: false },
    });
    if (!current) throw new NotFoundException('Option not found');
    // An option never moves to another sub-service.
    const data: UpdateVariantDto = { ...dto, serviceId: undefined };
    this.assertDiscount(
      data.price ?? Number(current.price),
      data.originalPrice === undefined
        ? current.originalPrice === null
          ? null
          : Number(current.originalPrice)
        : data.originalPrice,
    );
    const variant = await this.prisma.serviceVariant.update({
      where: { id },
      data,
    });
    await this.syncBasePrice(current.serviceId);
    return variant;
  }

  async deleteVariant(id: string) {
    const current = await this.prisma.serviceVariant.findFirst({
      where: { id, isDeleted: false },
    });
    if (!current) throw new NotFoundException('Option not found');
    const variant = await this.prisma.serviceVariant.update({
      where: { id },
      data: { isDeleted: true, isActive: false, deletedAt: new Date() },
    });
    await this.syncBasePrice(current.serviceId);
    return variant;
  }

  async createFaq(dto: CreateFaqDto) {
    if (Boolean(dto.categoryId) === Boolean(dto.serviceId))
      throw new BadRequestException(
        'Attach the FAQ to either a main service or a sub-service',
      );
    if (dto.categoryId) await this.mustExist('mainService', dto.categoryId);
    if (dto.serviceId) await this.mustExist('subService', dto.serviceId);
    return this.prisma.serviceFaq.create({ data: dto });
  }

  async updateFaq(id: string, dto: UpdateFaqDto) {
    // An FAQ stays where it was created.
    const data: UpdateFaqDto = {
      ...dto,
      categoryId: undefined,
      serviceId: undefined,
    };
    await this.mustExist('faq', id);
    return this.prisma.serviceFaq.update({ where: { id }, data });
  }

  async deleteFaq(id: string) {
    await this.mustExist('faq', id);
    return this.prisma.serviceFaq.delete({ where: { id } });
  }

  async reorder(dto: ReorderDto) {
    const updates = dto.items.map(({ id, sortOrder }) => {
      switch (dto.level) {
        case 'group':
          return this.prisma.serviceGroup.update({
            where: { id },
            data: { sortOrder },
          });
        case 'mainService':
          return this.prisma.serviceCategory.update({
            where: { id },
            data: { sortOrder },
          });
        case 'subService':
          return this.prisma.service.update({
            where: { id },
            data: { sortOrder },
          });
        case 'variant':
          return this.prisma.serviceVariant.update({
            where: { id },
            data: { sortOrder },
          });
        case 'faq':
          return this.prisma.serviceFaq.update({
            where: { id },
            data: { sortOrder },
          });
      }
    });
    await this.prisma.$transaction(updates);
    return { updated: updates.length };
  }

  private assertDiscount(
    price: number,
    originalPrice: number | null | undefined,
  ) {
    if (originalPrice != null && originalPrice <= price)
      throw new BadRequestException(
        'The old price must be higher than the price',
      );
  }

  /**
   * Keeps the sub-service's base price (used by older screens and the provider's skill list) equal to its
   * cheapest live option, and its price unit equal to that option's.
   */
  private async syncBasePrice(serviceId: string) {
    const cheapest = await this.prisma.serviceVariant.findFirst({
      where: { serviceId, isActive: true, isDeleted: false },
      orderBy: { price: 'asc' },
    });
    if (!cheapest) return;
    await this.prisma.service.update({
      where: { id: serviceId },
      data: {
        basePrice: cheapest.price,
        priceUnit: cheapest.priceUnit ?? PriceUnit.FIXED,
      },
    });
  }

  private async mustExist(
    level: 'group' | 'mainService' | 'subService' | 'faq',
    id: string,
  ) {
    const found =
      level === 'group'
        ? await this.prisma.serviceGroup.findFirst({
            where: { id, isDeleted: false },
            select: { id: true },
          })
        : level === 'mainService'
          ? await this.prisma.serviceCategory.findFirst({
              where: { id, isDeleted: false },
              select: { id: true },
            })
          : level === 'subService'
            ? await this.prisma.service.findFirst({
                where: { id, isDeleted: false },
                select: { id: true },
              })
            : await this.prisma.serviceFaq.findUnique({
                where: { id },
                select: { id: true },
              });
    if (!found) throw new NotFoundException('Not found');
  }
}

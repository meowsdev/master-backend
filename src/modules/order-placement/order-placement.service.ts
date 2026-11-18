import { assertNoPhoneNumber } from '../../common/contact-privacy';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PriceUnit, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LocationsService } from '../locations/locations.service';
import { OrdersService } from '../orders/orders.service';
import { PlaceOrderDto, QuoteOrderDto } from './dto/place-order.dto';
import { calculateQuote, PricedAnswer } from './order-pricing';
import { assertValidSchedule, TIME_SLOTS } from './order-schedule';

/** Only files this backend stored itself may be attached to an order. */
const UPLOAD_URL_PATTERN = /^\/uploads\/order-images\/[\w-]+\.(jpg|jpeg|png|webp)$/i;

/** How many units / square feet one order may cover, by how the sub-service is priced. */
const MAX_QUANTITY: Record<PriceUnit, number> = {
  FIXED: 1,
  PER_UNIT: 10,
  PER_SQFT: 10_000,
};

@Injectable()
export class OrderPlacementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly locations: LocationsService,
  ) {}

  /**
   * Public: everything the Place Order panel needs. Main services (categories)
   * with their sub-services and follow-up questions; "countable" is derived from
   * the sub-service's price unit, which admins control.
   */
  async getCatalog() {
    const categories = await this.prisma.serviceCategory.findMany({
      where: { isActive: true, isDeleted: false },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        iconUrl: true,
        services: {
          where: { isActive: true, isDeleted: false },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, nameBn: true, imageUrl: true, basePrice: true, priceUnit: true },
        },
        questions: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            text: true,
            textBn: true,
            options: {
              orderBy: { sortOrder: 'asc' },
              select: { id: true, label: true, labelBn: true, unitPrice: true, isCountable: true },
            },
          },
        },
      },
    });

    return {
      timeSlots: TIME_SLOTS,
      categories: categories.map((category) => ({
        ...category,
        services: category.services.map(({ priceUnit, ...service }) => ({
          ...service,
          priceUnit,
          isCountable: priceUnit !== PriceUnit.FIXED,
          maxQuantity: MAX_QUANTITY[priceUnit],
        })),
      })),
    };
  }

  /** Live total for the panel; same maths as the real order, nothing is saved. */
  async quote(dto: QuoteOrderDto) {
    const { quote } = await this.priceSelection(dto);
    return quote;
  }

  async placeOrder(dto: PlaceOrderDto, user: { id: string; role: UserRole }) {
    // The provider reads this text, so it cannot carry the customer's phone number.
    assertNoPhoneNumber(dto.description);
    const { subService, quote } = await this.priceSelection(dto);

    if (!this.locations.isValidLocation(dto.districtId, dto.upazilaId)) {
      throw new BadRequestException('Please choose a valid district and upazila');
    }
    assertValidSchedule(dto.scheduledDate, dto.timeSlot);
    const imageUrls = dto.imageUrls ?? [];
    if (imageUrls.some((url) => !UPLOAD_URL_PATTERN.test(url))) {
      throw new BadRequestException('Unsupported image attachment');
    }

    // Reuses the order rules: provider matching and one active order per service.
    const order = await this.orders.create(
      { serviceId: subService.id, originalPrice: quote.total },
      user,
      { districtId: dto.districtId, upazilaId: dto.upazilaId },
    );

    const quantity = quote.lines[0].count;
    try {
      await this.prisma.$transaction([
        this.prisma.orderItem.create({
          data: {
            orderId: order.id,
            subServiceId: subService.id,
            nameSnapshot: subService.name.slice(0, 100),
            unitPriceSnapshot: subService.basePrice,
            priceUnitSnapshot: subService.priceUnit,
            quantity,
            lineTotal: quote.lines[0].amount,
            durationSnapshot: subService.durationMin,
          },
        }),
        this.prisma.orderBookingDetail.create({
          data: {
            orderId: order.id,
            subServiceId: subService.id,
            subServiceName: subService.name,
            quantity,
            description: dto.description?.trim() || null,
            districtId: dto.districtId,
            upazilaId: dto.upazilaId,
            addressDetail: dto.addressDetail.trim(),
            scheduledDate: new Date(`${dto.scheduledDate}T00:00:00.000Z`),
            timeSlot: dto.timeSlot,
            imageUrls,
            // Surcharge lines (e.g. risky outdoor unit) have no sub-service, so they live here.
            priceBreakdown: quote.lines as unknown as Prisma.InputJsonValue,
          },
        }),
      ]);
    } catch (error) {
      // Never leave a priced order behind without the details the provider needs.
      await this.prisma.order.delete({ where: { id: order.id } });
      throw error;
    }

    return { order, quote };
  }

  private async priceSelection(dto: QuoteOrderDto) {
    const subService = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, isActive: true, isDeleted: false },
      include: {
        category: {
          select: {
            isActive: true,
            questions: {
              where: { isActive: true },
              select: { id: true, text: true, options: { select: { id: true, label: true, unitPrice: true, isCountable: true } } },
            },
          },
        },
      },
    });
    if (!subService || !subService.category.isActive) throw new NotFoundException('Service not found');

    const quote = calculateQuote(
      {
        name: subService.name,
        unitPrice: Number(subService.basePrice),
        isCountable: subService.priceUnit !== PriceUnit.FIXED,
        maxCount: MAX_QUANTITY[subService.priceUnit],
      },
      dto.quantity ?? 1,
      this.resolveAnswers(dto, subService.category.questions),
    );
    return { subService, quote };
  }

  private resolveAnswers(
    dto: QuoteOrderDto,
    questions: Array<{
      id: string;
      text: string;
      options: Array<{ id: string; label: string; unitPrice: Prisma.Decimal; isCountable: boolean }>;
    }>,
  ): PricedAnswer[] {
    return (dto.answers ?? []).map((answer) => {
      const question = questions.find((item) => item.id === answer.questionId);
      const option = question?.options.find((item) => item.id === answer.optionId);
      if (!question || !option) throw new BadRequestException('Invalid answer for this service');
      return {
        questionText: question.text,
        option: { ...option, unitPrice: Number(option.unitPrice) },
        count: answer.count ?? 1,
      };
    });
  }
}

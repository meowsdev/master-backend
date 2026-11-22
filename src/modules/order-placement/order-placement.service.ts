import { assertNoPhoneNumber } from '../../common/contact-privacy';
import { phoneLookupVariants } from '../../common/phone';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, PriceUnit, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LocationsService } from '../locations/locations.service';
import { OrdersService } from '../orders/orders.service';
import { AdminPlaceOrderDto, PlaceOrderDto, QuoteOrderDto } from './dto/place-order.dto';
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
  private readonly logger = new Logger(OrderPlacementService.name);

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

  /**
   * An admin books on behalf of a customer. The number is the customer's identity: an existing customer is
   * reused, a new number becomes a customer account (no name needed; they can sign in later with OTP). The
   * order then goes through exactly the same pricing, area matching and dispatch as one placed in the app.
   */
  async placeOrderForCustomer(dto: AdminPlaceOrderDto) {
    const { customerPhone, customerName, ...order } = dto;

    // Found however the number was stored (+880..., 880..., 01...), so no second account is made next to theirs.
    const customer = await this.findUserByPhone(customerPhone);
    if (customer && customer.role !== UserRole.CUSTOMER) {
      throw new BadRequestException(`This number belongs to a ${customer.role.toLowerCase()}, not a customer`);
    }
    if (customer && customer.status !== 'ACTIVE') {
      throw new BadRequestException('This customer is blocked or banned and cannot be ordered for');
    }
    const customerId =
      customer?.id ??
      (
        await this.prisma.user.create({
          data: { mobileNumber: customerPhone, name: customerName?.trim() || null, role: UserRole.CUSTOMER, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;

    return this.placeOrder(order, { id: customerId, role: UserRole.CUSTOMER });
  }

  /**
   * Admin's New order form: who this number is, so the form fills in the customer's name and the place they
   * use (their saved address, else their latest order's). `found: false` for a new number.
   */
  async lookupCustomer(phone: string) {
    const user = await this.findUserByPhone(phone);
    if (!user) return { found: false as const };

    const base = { found: true as const, name: user.name, role: user.role, status: user.status };
    if (user.role !== UserRole.CUSTOMER) return { ...base, districtId: null, upazilaId: null, addressDetail: null };

    const [saved, lastOrder] = await Promise.all([
      this.prisma.userAddress.findFirst({ where: { userId: user.id, isDefault: true }, select: { addressText: true } }),
      this.prisma.orderBookingDetail.findFirst({
        where: { order: { customer: { userId: user.id } } },
        orderBy: { createdAt: 'desc' },
        select: { districtId: true, upazilaId: true, addressDetail: true },
      }),
    ]);
    // A district without its upazila is half a place, so the profile's pair is used only when both are there.
    const hasProfileArea = Boolean(user.districtId && user.upazilaId);

    return {
      ...base,
      districtId: hasProfileArea ? user.districtId : (lastOrder?.districtId ?? null),
      upazilaId: hasProfileArea ? user.upazilaId : (lastOrder?.upazilaId ?? null),
      addressDetail: saved?.addressText ?? lastOrder?.addressDetail ?? null,
    };
  }

  private findUserByPhone(phone: string) {
    return this.prisma.user.findFirst({
      where: { mobileNumber: { in: phoneLookupVariants(phone) } },
      // If old data holds the number twice, the first (original) account wins.
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, role: true, status: true, districtId: true, upazilaId: true },
    });
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

    await this.rememberAddress(user.id, dto);
    return { order, quote };
  }

  /**
   * Keeps the place of the latest order on the customer's profile (district, upazila and the default saved
   * address), so the next Place Order form starts filled in. The order is already placed, so a failure
   * here is only logged: the customer just types the address again next time.
   */
  private async rememberAddress(userId: string, dto: PlaceOrderDto) {
    const addressText = dto.addressDetail.trim();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { districtId: dto.districtId, upazilaId: dto.upazilaId } });
        const saved = await tx.userAddress.findFirst({ where: { userId, isDefault: true }, select: { id: true } });
        if (saved) await tx.userAddress.update({ where: { id: saved.id }, data: { addressText } });
        else await tx.userAddress.create({ data: { userId, addressText, isDefault: true } });
      });
    } catch (error) {
      this.logger.warn(`Order address not saved to the profile: ${(error as Error).message}`);
    }
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

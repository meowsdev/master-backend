import { assertNoPhoneNumber } from '../../common/contact-privacy';
import { phoneLookupVariants } from '../../common/phone';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OrderCreator, Prisma, PriceUnit, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LocationsService } from '../locations/locations.service';
import { OrderOrigin, OrdersService } from '../orders/orders.service';
import { AdminCustomOrderDto, AdminPlaceCartOrderDto, AdminPlaceOrderDto, CustomerCustomOrderDto, OrderPlaceFieldsDto, PlaceCartOrderDto, PlaceOrderDto, QuoteCartDto, QuoteOrderDto } from './dto/place-order.dto';
import { ensureCustomService } from './custom-service';
import { ensureCategoryCustomService } from '../catalog/catalog-custom';
import { calculateCartQuote, calculateQuote, PriceLine, PricedAnswer } from './order-pricing';
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
          where: { isActive: true, isDeleted: false, isCustom: false },
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
  async placeOrderForCustomer(dto: AdminPlaceOrderDto, origin: OrderOrigin) {
    const { customerPhone, customerName, ...order } = dto;
    const customerId = await this.resolveCustomerForAdmin(customerPhone, customerName);
    return this.placeOrder(order, { id: customerId, role: UserRole.CUSTOMER }, origin);
  }

  /**
   * Who is booking for a customer by phone number: a staff member (the order is dispatched as usual), or a
   * provider for their own customer (the order is theirs at once, charged by the admin's provider-order rule).
   */
  async originFor(user: { id: string; role: UserRole }): Promise<OrderOrigin> {
    if (user.role !== UserRole.PROVIDER) return { createdByRole: OrderCreator.ADMIN, createdById: user.id };
    const provider = await this.prisma.providerProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!provider) throw new BadRequestException('Provider profile not found');
    return { createdByRole: OrderCreator.PROVIDER, createdById: user.id, ownProviderId: provider.id };
  }

  /**
   * An admin books a service that is not in the catalog: they type the main service, the sub-service, the
   * details and the price. The order hangs off the hidden custom service, keeps the typed names on its booking
   * detail (every order screen shows those), and is offered to every available provider in the area.
   */
  async placeCustomOrderForCustomer(dto: AdminCustomOrderDto, origin: OrderOrigin) {
    const mainServiceName = dto.mainServiceName.trim();
    const subServiceName = dto.subServiceName.trim();
    if (!mainServiceName || !subServiceName) throw new BadRequestException('Write the main service and the sub-service');
    // Providers read all of these, so none may carry a phone number.
    [mainServiceName, subServiceName, dto.description].forEach((text) => assertNoPhoneNumber(text));
    if (!this.locations.isValidLocation(dto.districtId, dto.upazilaId)) {
      throw new BadRequestException('Please choose a valid district and upazila');
    }
    assertValidSchedule(dto.scheduledDate, dto.timeSlot);

    const customerId = await this.resolveCustomerForAdmin(dto.customerPhone, dto.customerName);
    const serviceId = await ensureCustomService(this.prisma);
    const location = { districtId: dto.districtId, upazilaId: dto.upazilaId };
    const order = await this.orders.create({ serviceId, originalPrice: dto.price }, { id: customerId, role: UserRole.CUSTOMER }, location, { origin });

    const priceLine = { label: subServiceName, unitPrice: dto.price, count: 1, amount: dto.price };
    try {
      await this.prisma.$transaction([
        this.prisma.orderItem.create({
          data: {
            orderId: order.id,
            subServiceId: serviceId,
            nameSnapshot: subServiceName.slice(0, 100),
            unitPriceSnapshot: dto.price,
            priceUnitSnapshot: PriceUnit.FIXED,
            quantity: 1,
            lineTotal: dto.price,
          },
        }),
        this.prisma.orderBookingDetail.create({
          data: {
            orderId: order.id,
            subServiceId: serviceId,
            subServiceName,
            customServiceName: mainServiceName,
            quantity: 1,
            description: dto.description?.trim() || null,
            districtId: dto.districtId,
            upazilaId: dto.upazilaId,
            addressDetail: dto.addressDetail.trim(),
            scheduledDate: new Date(`${dto.scheduledDate}T00:00:00.000Z`),
            timeSlot: dto.timeSlot,
            imageUrls: [],
            priceBreakdown: [priceLine] as unknown as Prisma.InputJsonValue,
          },
        }),
      ]);
    } catch (error) {
      // Never leave a priced order behind without the details the provider needs.
      await this.prisma.order.delete({ where: { id: order.id } });
      throw error;
    }

    await this.rememberAddress(customerId, dto);
    return { order, quote: { lines: [priceLine], total: dto.price } };
  }

  /**
   * The customer an admin books for. The number is their identity: an existing customer is reused (found
   * however the number was stored: +880..., 880..., 01...), a new number becomes a customer account.
   */
  private async resolveCustomerForAdmin(customerPhone: string, customerName?: string) {
    const customer = await this.findUserByPhone(customerPhone);
    if (customer && customer.role !== UserRole.CUSTOMER) {
      throw new BadRequestException(`This number belongs to a ${customer.role.toLowerCase()}, not a customer`);
    }
    if (customer && customer.status !== 'ACTIVE') {
      throw new BadRequestException('This customer is blocked or banned and cannot be ordered for');
    }
    if (customer) return customer.id;
    const created = await this.prisma.user.create({
      data: { mobileNumber: customerPhone, name: customerName?.trim() || null, role: UserRole.CUSTOMER, status: 'ACTIVE' },
      select: { id: true },
    });
    return created.id;
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

  async placeOrder(dto: PlaceOrderDto, user: { id: string; role: UserRole }, origin?: OrderOrigin) {
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
      { origin },
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
  private async rememberAddress(userId: string, dto: Pick<PlaceOrderDto, 'districtId' | 'upazilaId' | 'addressDetail'>) {
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

  /** Live total of a cart; same maths as the real order, nothing is saved. */
  async quoteCart(dto: QuoteCartDto) {
    const { quote } = await this.priceCart(dto);
    return quote;
  }

  /**
   * A cart of one main service's options becomes one order (one chat tab). Its first sub-service is the order's
   * service for older screens; every option is an order item, and only providers offering all of them are asked.
   */
  /** An admin orders a cart for a customer by phone number; then it is exactly the customer's own cart order. */
  async placeCartOrderForCustomer(dto: AdminPlaceCartOrderDto, origin: OrderOrigin) {
    const { customerPhone, customerName, ...cart } = dto;
    const customerId = await this.resolveCustomerForAdmin(customerPhone, customerName);
    return this.placeCartOrder(cart, { id: customerId, role: UserRole.CUSTOMER }, origin);
  }

  async placeCartOrder(dto: PlaceCartOrderDto, user: { id: string; role: UserRole }, origin?: OrderOrigin) {
    assertNoPhoneNumber(dto.description);
    const { picked, quote } = await this.priceCart(dto);
    this.assertPlace(dto);

    const serviceIds = [...new Set(picked.map((item) => item.variant.serviceId))];
    const order = await this.orders.create({ serviceId: serviceIds[0], originalPrice: quote.total }, user, { districtId: dto.districtId, upazilaId: dto.upazilaId }, { serviceIds, origin });

    const firstName = picked[0].variant.service.name;
    const title = picked.length === 1 ? firstName : `${firstName} +${picked.length - 1}`;
    try {
      await this.prisma.$transaction([
        ...picked.map((item, index) =>
          this.prisma.orderItem.create({
            data: {
              orderId: order.id,
              subServiceId: item.variant.serviceId,
              variantId: item.variant.id,
              variantNameSnapshot: item.variant.name.slice(0, 100),
              nameSnapshot: item.variant.service.name.slice(0, 100),
              unitPriceSnapshot: item.variant.price,
              priceUnitSnapshot: item.variant.priceUnit,
              quantity: quote.lines[index].count,
              lineTotal: quote.lines[index].amount,
              durationSnapshot: item.variant.durationMin,
            },
          }),
        ),
        this.bookingDetail(order.id, dto, { subServiceId: serviceIds[0], subServiceName: title, quantity: quote.lines[0].count, description: dto.description, lines: quote.lines }),
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
   * The customer's Custom card: a problem the catalog does not list. The order has no price (the visit is free);
   * it lands in the main service's chat as a tab and the provider sends a quote after the visit (OrderQuoteService).
   */
  async placeCustomerCustomOrder(dto: CustomerCustomOrderDto, user: { id: string; role: UserRole }) {
    assertNoPhoneNumber(dto.description);
    const category = await this.prisma.serviceCategory.findFirst({ where: { id: dto.categoryId, isActive: true, isDeleted: false }, select: { id: true, name: true } });
    if (!category) throw new NotFoundException('Service not found');
    this.assertPlace(dto);

    const serviceId = await ensureCategoryCustomService(this.prisma, category.id);
    const order = await this.orders.create({ serviceId, originalPrice: 0 }, user, { districtId: dto.districtId, upazilaId: dto.upazilaId }, { serviceIds: [serviceId], isPricePending: true });

    const name = `Custom: ${category.name}`.slice(0, 100);
    try {
      await this.prisma.$transaction([
        this.prisma.orderItem.create({
          data: { orderId: order.id, subServiceId: serviceId, nameSnapshot: name, unitPriceSnapshot: 0, priceUnitSnapshot: PriceUnit.FIXED, quantity: 1, lineTotal: 0 },
        }),
        this.bookingDetail(order.id, dto, { subServiceId: serviceId, subServiceName: name, quantity: 1, description: dto.description, lines: [] }),
      ]);
    } catch (error) {
      await this.prisma.order.delete({ where: { id: order.id } });
      throw error;
    }

    await this.rememberAddress(user.id, dto);
    return { order, quote: { lines: [], total: 0 } };
  }

  private assertPlace(dto: OrderPlaceFieldsDto) {
    if (!this.locations.isValidLocation(dto.districtId, dto.upazilaId)) {
      throw new BadRequestException('Please choose a valid district and upazila');
    }
    assertValidSchedule(dto.scheduledDate, dto.timeSlot);
    if ((dto.imageUrls ?? []).some((url) => !UPLOAD_URL_PATTERN.test(url))) {
      throw new BadRequestException('Unsupported image attachment');
    }
  }

  private bookingDetail(
    orderId: string,
    dto: OrderPlaceFieldsDto,
    detail: { subServiceId: string; subServiceName: string; quantity: number; description?: string; lines: PriceLine[] },
  ) {
    return this.prisma.orderBookingDetail.create({
      data: {
        orderId,
        subServiceId: detail.subServiceId,
        subServiceName: detail.subServiceName.slice(0, 200),
        quantity: detail.quantity,
        description: detail.description?.trim() || null,
        districtId: dto.districtId,
        upazilaId: dto.upazilaId,
        addressDetail: dto.addressDetail.trim(),
        scheduledDate: new Date(`${dto.scheduledDate}T00:00:00.000Z`),
        timeSlot: dto.timeSlot,
        imageUrls: dto.imageUrls ?? [],
        priceBreakdown: detail.lines as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Resolves the cart's options (all live, all of the given main service) and prices them. */
  private async priceCart(dto: QuoteCartDto) {
    if (dto.items.length === 0) throw new BadRequestException('Add at least one service to the cart');
    const variants = await this.prisma.serviceVariant.findMany({
      where: {
        id: { in: dto.items.map((item) => item.variantId) },
        isActive: true,
        isDeleted: false,
        service: { isActive: true, isDeleted: false, isCustom: false, categoryId: dto.categoryId },
      },
      select: { id: true, name: true, price: true, priceUnit: true, durationMin: true, serviceId: true, service: { select: { name: true } } },
    });
    const picked = dto.items.map((item) => {
      const variant = variants.find((row) => row.id === item.variantId);
      if (!variant) throw new BadRequestException('A service in your cart is no longer available');
      return { variant, quantity: item.quantity ?? 1 };
    });

    const category = await this.prisma.serviceCategory.findFirst({
      where: { id: dto.categoryId, isActive: true, isDeleted: false },
      select: {
        questions: {
          where: { isActive: true },
          select: { id: true, text: true, options: { select: { id: true, label: true, unitPrice: true, isCountable: true } } },
        },
      },
    });
    if (!category) throw new NotFoundException('Service not found');

    const quote = calculateCartQuote(
      picked.map(({ variant, quantity }) => ({
        name: variant.name === 'Standard' ? variant.service.name : `${variant.service.name} (${variant.name})`,
        unitPrice: Number(variant.price),
        isCountable: variant.priceUnit !== PriceUnit.FIXED,
        maxCount: MAX_QUANTITY[variant.priceUnit],
        quantity,
      })),
      this.resolveAnswers(dto, category.questions),
    );
    return { picked, quote };
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
    dto: Pick<QuoteOrderDto, 'answers'>,
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

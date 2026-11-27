import { BadRequestException } from '@nestjs/common';
import { AdminPlaceOrderDto } from './dto/place-order.dto';
import { OrderPlacementService } from './order-placement.service';
import { resetCustomServiceCache } from './custom-service';

const adminOrigin = { createdByRole: 'ADMIN', createdById: 'admin-1' } as const;
const dto = { customerPhone: '+8801712345678', customerName: ' Rafi ', serviceId: 's1', districtId: 1, upazilaId: 1, addressDetail: 'x', scheduledDate: '2030-01-01', timeSlot: '10:00' } as AdminPlaceOrderDto;

function build(existing: { id: string; role: string; status: string } | null) {
  const prisma = {
    user: {
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue({ id: 'new-user', role: 'CUSTOMER', status: 'ACTIVE' }),
    },
  };
  const service = new OrderPlacementService(prisma as never, {} as never, {} as never);
  const placeOrder = jest.spyOn(service, 'placeOrder').mockResolvedValue({ order: {} } as never);
  return { service, prisma, placeOrder };
}

describe('OrderPlacementService.placeOrderForCustomer', () => {
  it('creates a customer account for a new number and orders as that customer', async () => {
    const { service, prisma, placeOrder } = build(null);
    await service.placeOrderForCustomer(dto, adminOrigin);
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mobileNumber: '+8801712345678', name: 'Rafi', role: 'CUSTOMER' }) }));
    expect(placeOrder).toHaveBeenCalledWith(expect.not.objectContaining({ customerPhone: expect.anything() }), { id: 'new-user', role: 'CUSTOMER' }, adminOrigin);
  });

  it('reuses an existing customer', async () => {
    const { service, prisma, placeOrder } = build({ id: 'c1', role: 'CUSTOMER', status: 'ACTIVE' });
    await service.placeOrderForCustomer(dto, adminOrigin);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(placeOrder).toHaveBeenCalledWith(expect.anything(), { id: 'c1', role: 'CUSTOMER' }, adminOrigin);
  });

  it('refuses a number that belongs to a provider or other role', async () => {
    const { service, placeOrder } = build({ id: 'p1', role: 'PROVIDER', status: 'ACTIVE' });
    await expect(service.placeOrderForCustomer(dto, adminOrigin)).rejects.toBeInstanceOf(BadRequestException);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('refuses a blocked or banned customer', async () => {
    const { service, placeOrder } = build({ id: 'c1', role: 'CUSTOMER', status: 'SUSPENDED' });
    await expect(service.placeOrderForCustomer(dto, adminOrigin)).rejects.toBeInstanceOf(BadRequestException);
    expect(placeOrder).not.toHaveBeenCalled();
  });
});

describe('OrderPlacementService.lookupCustomer (admin New order form)', () => {
  function buildLookup(user: unknown, saved: unknown = null, lastOrder: unknown = null) {
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(user) },
      userAddress: { findFirst: jest.fn().mockResolvedValue(saved) },
      orderBookingDetail: { findFirst: jest.fn().mockResolvedValue(lastOrder) },
    };
    return { service: new OrderPlacementService(prisma as never, {} as never, {} as never), prisma };
  }
  const customer = { id: 'c1', name: 'Rafi', role: 'CUSTOMER', status: 'ACTIVE', districtId: 1, upazilaId: 9 };

  it('says a new number is not found', async () => {
    const { service } = buildLookup(null);
    await expect(service.lookupCustomer('+8801712345678')).resolves.toEqual({ found: false });
  });

  it("finds the number however it was stored and returns the customer's name and saved place", async () => {
    const { service, prisma } = buildLookup(customer, { addressText: 'House 1, Road 2' });
    const result = await service.lookupCustomer('+8801712345678');
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { mobileNumber: { in: ['+8801712345678', '8801712345678', '01712345678'] } } }));
    expect(result).toEqual(expect.objectContaining({ found: true, name: 'Rafi', districtId: 1, upazilaId: 9, addressDetail: 'House 1, Road 2' }));
  });

  it('falls back to the latest order when nothing is saved on the profile', async () => {
    const { service } = buildLookup({ ...customer, districtId: null, upazilaId: null }, null, { districtId: 3, upazilaId: 30, addressDetail: 'Old place' });
    await expect(service.lookupCustomer('+8801712345678')).resolves.toEqual(expect.objectContaining({ districtId: 3, upazilaId: 30, addressDetail: 'Old place' }));
  });

  it('gives no address for a number that is not a customer', async () => {
    const { service, prisma } = buildLookup({ ...customer, role: 'PROVIDER' });
    await expect(service.lookupCustomer('+8801712345678')).resolves.toEqual(expect.objectContaining({ found: true, role: 'PROVIDER', addressDetail: null }));
    expect(prisma.userAddress.findFirst).not.toHaveBeenCalled();
  });
});


describe('OrderPlacementService.placeCustomOrderForCustomer (a service not in the catalog)', () => {
  const customDto = {
    customerPhone: '+8801712345678',
    mainServiceName: ' Generator ',
    subServiceName: ' Generator servicing ',
    description: 'Makes a noise',
    price: 2500,
    districtId: 1,
    upazilaId: 9,
    addressDetail: ' House 1 ',
    // Tomorrow: bookings open only 30 days ahead.
    scheduledDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    timeSlot: '09:00 AM - 11:00 AM',
  };

  function buildCustom() {
    resetCustomServiceCache();
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', role: 'CUSTOMER', status: 'ACTIVE' }) },
      serviceCategory: { upsert: jest.fn().mockResolvedValue({ id: 'custom-cat' }) },
      service: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'custom-svc' }) },
      orderItem: { create: jest.fn().mockReturnValue('item') },
      orderBookingDetail: { create: jest.fn().mockReturnValue('detail') },
      order: { delete: jest.fn() },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const orders = { create: jest.fn().mockResolvedValue({ id: 'o1' }) };
    const locations = { isValidLocation: jest.fn().mockReturnValue(true) };
    const service = new OrderPlacementService(prisma as never, orders as never, locations as never);
    // Saving the place to the profile is covered elsewhere.
    jest.spyOn(service as unknown as { rememberAddress: () => Promise<void> }, 'rememberAddress').mockResolvedValue();
    return { service, prisma, orders };
  }

  it('prices the order at what the admin typed, on the hidden custom service, with the typed names kept', async () => {
    const { service, prisma, orders } = buildCustom();
    const result = await service.placeCustomOrderForCustomer(customDto, adminOrigin);

    expect(prisma.service.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }));
    expect(orders.create).toHaveBeenCalledWith({ serviceId: 'custom-svc', originalPrice: 2500 }, { id: 'c1', role: 'CUSTOMER' }, { districtId: 1, upazilaId: 9 }, { origin: adminOrigin });
    expect(prisma.orderBookingDetail.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customServiceName: 'Generator', subServiceName: 'Generator servicing', description: 'Makes a noise', addressDetail: 'House 1' }),
    });
    expect(result.quote).toEqual({ lines: [{ label: 'Generator servicing', unitPrice: 2500, count: 1, amount: 2500 }], total: 2500 });
  });

  it('refuses a phone number in the typed names (providers read them)', async () => {
    const { service, orders } = buildCustom();
    await expect(service.placeCustomOrderForCustomer({ ...customDto, subServiceName: 'Call 01712345678' }, adminOrigin)).rejects.toBeInstanceOf(BadRequestException);
    expect(orders.create).not.toHaveBeenCalled();
  });
});

describe('OrderPlacementService.originFor (who is booking for a customer)', () => {
  function buildOrigin(provider: { id: string } | null) {
    const prisma = { providerProfile: { findUnique: jest.fn().mockResolvedValue(provider) } };
    return new OrderPlacementService(prisma as never, {} as never, {} as never);
  }

  it('tags a staff booking as ADMIN, dispatched as usual', async () => {
    await expect(buildOrigin(null).originFor({ id: 'a1', role: 'MANAGER' })).resolves.toEqual({ createdByRole: 'ADMIN', createdById: 'a1' });
  });

  it("tags a provider's booking as PROVIDER and keeps it for that provider", async () => {
    await expect(buildOrigin({ id: 'pp1' }).originFor({ id: 'u1', role: 'PROVIDER' })).resolves.toEqual({ createdByRole: 'PROVIDER', createdById: 'u1', ownProviderId: 'pp1' });
  });

  it('refuses a provider account with no provider profile', async () => {
    await expect(buildOrigin(null).originFor({ id: 'u1', role: 'PROVIDER' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

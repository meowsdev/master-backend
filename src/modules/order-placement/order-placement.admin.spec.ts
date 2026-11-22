import { BadRequestException } from '@nestjs/common';
import { AdminPlaceOrderDto } from './dto/place-order.dto';
import { OrderPlacementService } from './order-placement.service';

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
    await service.placeOrderForCustomer(dto);
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mobileNumber: '+8801712345678', name: 'Rafi', role: 'CUSTOMER' }) }));
    expect(placeOrder).toHaveBeenCalledWith(expect.not.objectContaining({ customerPhone: expect.anything() }), { id: 'new-user', role: 'CUSTOMER' });
  });

  it('reuses an existing customer', async () => {
    const { service, prisma, placeOrder } = build({ id: 'c1', role: 'CUSTOMER', status: 'ACTIVE' });
    await service.placeOrderForCustomer(dto);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(placeOrder).toHaveBeenCalledWith(expect.anything(), { id: 'c1', role: 'CUSTOMER' });
  });

  it('refuses a number that belongs to a provider or other role', async () => {
    const { service, placeOrder } = build({ id: 'p1', role: 'PROVIDER', status: 'ACTIVE' });
    await expect(service.placeOrderForCustomer(dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it('refuses a blocked or banned customer', async () => {
    const { service, placeOrder } = build({ id: 'c1', role: 'CUSTOMER', status: 'SUSPENDED' });
    await expect(service.placeOrderForCustomer(dto)).rejects.toBeInstanceOf(BadRequestException);
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


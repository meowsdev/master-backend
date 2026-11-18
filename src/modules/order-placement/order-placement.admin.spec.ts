import { BadRequestException } from '@nestjs/common';
import { AdminPlaceOrderDto } from './dto/place-order.dto';
import { OrderPlacementService } from './order-placement.service';

const dto = { customerPhone: '+8801712345678', customerName: ' Rafi ', serviceId: 's1', districtId: 1, upazilaId: 1, addressDetail: 'x', scheduledDate: '2030-01-01', timeSlot: '10:00' } as AdminPlaceOrderDto;

function build(existing: { id: string; role: string; status: string } | null) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(existing),
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

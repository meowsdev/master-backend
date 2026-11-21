import { OrderPlacementService } from './order-placement.service';
import { PlaceOrderDto } from './dto/place-order.dto';

const dto = { districtId: 1, upazilaId: 10, addressDetail: '  বাড়ি ১২, রোড ৫  ' } as PlaceOrderDto;

function build(savedAddress: { id: string } | null) {
  const tx = {
    user: { update: jest.fn() },
    userAddress: { findFirst: jest.fn().mockResolvedValue(savedAddress), update: jest.fn(), create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn<Promise<unknown>, [(client: typeof tx) => unknown]>(async (callback) => callback(tx)) };
  const service = new OrderPlacementService(prisma as never, {} as never, {} as never);
  // The step that runs once the order is placed.
  const remember = (service as unknown as { rememberAddress: (userId: string, body: PlaceOrderDto) => Promise<void> }).rememberAddress.bind(service);
  return { remember, tx, prisma };
}

describe('OrderPlacementService remembers where the customer ordered', () => {
  it('saves the district, upazila and address of the first order to the profile', async () => {
    const { remember, tx } = build(null);
    await remember('u-1', dto);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'u-1' }, data: { districtId: 1, upazilaId: 10 } });
    expect(tx.userAddress.create).toHaveBeenCalledWith({ data: { userId: 'u-1', addressText: 'বাড়ি ১২, রোড ৫', isDefault: true } });
  });

  it('keeps one saved address and updates it to the latest order', async () => {
    const { remember, tx } = build({ id: 'addr-1' });
    await remember('u-1', dto);
    expect(tx.userAddress.update).toHaveBeenCalledWith({ where: { id: 'addr-1' }, data: { addressText: 'বাড়ি ১২, রোড ৫' } });
    expect(tx.userAddress.create).not.toHaveBeenCalled();
  });

  it('never fails the already placed order when saving the address fails', async () => {
    const { remember, prisma } = build(null);
    prisma.$transaction.mockRejectedValueOnce(new Error('database down'));
    await expect(remember('u-1', dto)).resolves.toBeUndefined();
  });
});

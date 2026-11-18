import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProviderServiceAreasService } from './provider-service-areas.service';

function build(options: { hasProfile?: boolean; validPair?: boolean } = {}) {
  const prisma = {
    providerProfile: { findUnique: jest.fn().mockResolvedValue(options.hasProfile === false ? null : { id: 'p1' }) },
    providerServiceArea: {
      findMany: jest.fn().mockResolvedValue([{ districtId: 1, upazilaId: 10 }]),
      deleteMany: jest.fn().mockReturnValue('delete'),
      createMany: jest.fn().mockReturnValue('create'),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const locations = { isValidLocation: jest.fn().mockReturnValue(options.validPair ?? true) };
  return { service: new ProviderServiceAreasService(prisma as never, locations as never), prisma };
}

describe('ProviderServiceAreasService', () => {
  it('finds the provider from the session user, never from the request', async () => {
    const { service, prisma } = build();
    await service.list('user-1');
    expect(prisma.providerProfile.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' }, select: { id: true } });
  });

  it('turns away a user who has no provider profile', async () => {
    const { service } = build({ hasProfile: false });
    await expect(service.list('user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an upazila that is not in the district', async () => {
    const { service, prisma } = build({ validPair: false });
    await expect(service.replace('user-1', [{ districtId: 1, upazilaId: 99 }])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('replaces the whole set at once and drops duplicate upazilas', async () => {
    const { service, prisma } = build();
    await service.replace('user-1', [
      { districtId: 1, upazilaId: 10 },
      { districtId: 1, upazilaId: 10 },
      { districtId: 1, upazilaId: 11 },
    ]);
    expect(prisma.providerServiceArea.createMany).toHaveBeenCalledWith({
      data: [
        { providerId: 'p1', districtId: 1, upazilaId: 10 },
        { providerId: 'p1', districtId: 1, upazilaId: 11 },
      ],
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(['delete', 'create']);
  });
});

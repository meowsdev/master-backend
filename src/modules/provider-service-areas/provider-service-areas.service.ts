import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LocationsService } from '../locations/locations.service';
import { ServiceAreaDto } from './dto/set-service-areas.dto';

/** The upazilas a provider takes orders in. Order dispatch reads them; only the provider changes them. */
@Injectable()
export class ProviderServiceAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locations: LocationsService,
  ) {}

  async list(userId: string) {
    const provider = await this.findProvider(userId);
    return this.prisma.providerServiceArea.findMany({
      where: { providerId: provider.id },
      orderBy: [{ districtId: 'asc' }, { upazilaId: 'asc' }],
      select: { districtId: true, upazilaId: true },
    });
  }

  /** Replaces the whole set in one go, so the screen's list is always exactly what is saved. */
  async replace(userId: string, areas: ServiceAreaDto[]) {
    const provider = await this.findProvider(userId);

    const unique = [...new Map(areas.map((area) => [area.upazilaId, area])).values()];
    const invalid = unique.find((area) => !this.locations.isValidLocation(area.districtId, area.upazilaId));
    if (invalid) throw new BadRequestException('One of the upazilas does not belong to its district');

    await this.prisma.$transaction([
      this.prisma.providerServiceArea.deleteMany({ where: { providerId: provider.id } }),
      this.prisma.providerServiceArea.createMany({
        data: unique.map(({ districtId, upazilaId }) => ({ providerId: provider.id, districtId, upazilaId })),
      }),
    ]);
    return this.list(userId);
  }

  // The provider comes from the session, never from the request, so nobody edits another provider's areas.
  private async findProvider(userId: string) {
    const provider = await this.prisma.providerProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!provider) throw new NotFoundException('Provider profile not found');
    return provider;
  }
}

import { LocationsService } from './locations.service';

describe('LocationsService', () => {
  const service = new LocationsService();

  it('loads every district and upazila of Bangladesh', () => {
    expect(service.getDistricts()).toHaveLength(64);
    const totalUpazilas = service
      .getDistricts()
      .reduce((sum, d) => sum + service.getUpazilas(d.id).length, 0);
    expect(totalUpazilas).toBe(495);
  });

  it('accepts an upazila that belongs to the district', () => {
    const [district] = service.getDistricts();
    const [upazila] = service.getUpazilas(district.id);
    expect(service.isValidLocation(district.id, upazila.id)).toBe(true);
  });

  it('rejects an upazila from a different district', () => {
    const [first, second] = service.getDistricts();
    const [foreignUpazila] = service.getUpazilas(second.id);
    expect(service.isValidLocation(first.id, foreignUpazila.id)).toBe(false);
  });

  it('rejects unknown ids', () => {
    expect(service.isValidLocation(9999, 9999)).toBe(false);
    expect(service.getUpazilas(9999)).toEqual([]);
  });
});

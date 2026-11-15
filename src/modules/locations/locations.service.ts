import { Injectable } from '@nestjs/common';
import { RAW_DISTRICTS, RAW_UPAZILAS } from './bangladesh-locations.data';

export interface DistrictOption {
  id: number;
  name: string;
  bnName: string;
}

export interface UpazilaOption extends DistrictOption {
  districtId: number;
}

const parseRecords = (raw: string): string[][] =>
  raw
    .split(';')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => record.split('|'));

/**
 * Read-only reference data for the sign-up form. The backend is the authority
 * on which district/upazila pairs are valid; the client only renders them.
 */
@Injectable()
export class LocationsService {
  private readonly districts: DistrictOption[] = parseRecords(
    RAW_DISTRICTS,
  ).map(([id, name, bnName]) => ({ id: Number(id), name, bnName }));

  private readonly upazilas: UpazilaOption[] = parseRecords(RAW_UPAZILAS).map(
    ([id, districtId, name, bnName]) => ({
      id: Number(id),
      districtId: Number(districtId),
      name,
      bnName,
    }),
  );

  getDistricts(): DistrictOption[] {
    return this.districts;
  }

  getUpazilas(districtId: number): UpazilaOption[] {
    return this.upazilas.filter((upazila) => upazila.districtId === districtId);
  }

  /** True only when the upazila exists AND belongs to the given district. */
  isValidLocation(districtId: number, upazilaId: number): boolean {
    return this.upazilas.some(
      (upazila) =>
        upazila.id === upazilaId && upazila.districtId === districtId,
    );
  }
}

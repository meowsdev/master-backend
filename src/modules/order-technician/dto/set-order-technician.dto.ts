import { IsUUID, ValidateIf } from 'class-validator';

export class SetOrderTechnicianDto {
  /** A technician profile id, or null to take the technician off the order. */
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  technicianId!: string | null;
}

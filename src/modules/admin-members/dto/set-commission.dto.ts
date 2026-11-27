import { Type } from 'class-transformer';
import { IsNumber, Max, Min, ValidateIf } from 'class-validator';

/**
 * An admin sets a provider's commission on orders from the platform: the platform's share, in percent (10 = 10%).
 * null: the provider follows the global rate again.
 */
export class SetCommissionDto {
  @ValidateIf((_dto, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionRate!: number | null;
}

/** A provider's charge on orders they create themselves, in percent; null follows the admin's one rule again. */
export class SetOwnOrderChargeDto {
  @ValidateIf((_dto, value) => value !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate!: number | null;
}

import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

/** An admin sets a provider's commission: the platform's share of their jobs, in percent (10 = 10%). */
export class SetCommissionDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  commissionRate!: number;
}

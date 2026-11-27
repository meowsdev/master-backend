import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, Max, Min } from 'class-validator';

/** The admin's rule for orders providers create: charge them or not, and at what percent (10 = 10%). */
export class ProviderOrderChargeDto {
  @IsBoolean()
  enabled!: boolean;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate!: number;
}

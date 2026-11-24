import { ProviderLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { METRIC_KEYS } from '../level-rules';
import type { MetricKey } from '../level-rules';

/** An admin gives a provider a level by hand; locked, the monthly evaluation leaves it alone. */
export class SetProviderLevelDto {
  @IsEnum(ProviderLevel)
  level!: ProviderLevel;

  @IsBoolean()
  isLocked!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** An admin changes what one number needs at each level. Ranges and order are checked in targetsProblem. */
export class SetMetricTargetsDto {
  @IsIn(METRIC_KEYS)
  metric!: MetricKey;

  @Type(() => Number)
  @IsNumber()
  LEVEL_1!: number;

  @Type(() => Number)
  @IsNumber()
  LEVEL_2!: number;

  @Type(() => Number)
  @IsNumber()
  TOP_RATED!: number;
}

/** The Levels tab: the same level for many providers at once (by their user ids). */
export class SetManyProvidersLevelDto extends SetProviderLevelDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  userIds!: string[];
}

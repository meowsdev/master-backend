import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** How much each factor counts, 0 (left out) to 10. Meanings in ranking-rules.ts. */
export class RankingWeightsDto {
  @IsInt() @Min(0) @Max(10) responseRate!: number;
  @IsInt() @Min(0) @Max(10) responseSpeed!: number;
  @IsInt() @Min(0) @Max(10) successScore!: number;
  @IsInt() @Min(0) @Max(10) rating!: number;
  @IsInt() @Min(0) @Max(10) behaviour!: number;
  @IsInt() @Min(0) @Max(10) level!: number;
  @IsInt() @Min(0) @Max(10) experience!: number;
  @IsInt() @Min(0) @Max(10) workload!: number;
  @IsInt() @Min(0) @Max(10) newcomer!: number;
}

export class UpdateDispatchSettingsDto {
  @ApiProperty()
  @IsBoolean()
  isEnabled!: boolean;

  @ApiProperty({ type: RankingWeightsDto })
  @ValidateNested()
  @Type(() => RankingWeightsDto)
  weights!: RankingWeightsDto;
}

/** Who would be asked first for this service and place, with weights that are being tried. */
export class PreviewDispatchDto {
  @ApiProperty()
  @IsString()
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  districtId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  upazilaId?: number;

  @ApiProperty({ type: RankingWeightsDto })
  @ValidateNested()
  @Type(() => RankingWeightsDto)
  weights!: RankingWeightsDto;
}

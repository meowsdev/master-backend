import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ExtraChargeItemDto {
  @ApiProperty({ example: 'Capacitor replacement' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  label!: string;

  @ApiProperty({ example: 800, minimum: 1 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  amount!: number;
}

export class CreateExtraChargeDto {
  @ApiProperty({ type: [ExtraChargeItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ExtraChargeItemDto)
  items!: ExtraChargeItemDto[];
}

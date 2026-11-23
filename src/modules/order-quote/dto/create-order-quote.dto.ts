import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class OrderQuoteItemDto {
  @ApiProperty({ example: 'Compressor repair (labour)' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  label!: string;

  @ApiProperty({ example: 1500, minimum: 1 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1_000_000)
  amount!: number;
}

export class CreateOrderQuoteDto {
  @ApiProperty({ type: [OrderQuoteItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => OrderQuoteItemDto)
  items!: OrderQuoteItemDto[];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { PriceUnit } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Fields shared by create and update: what the public service page shows, plus how the service is counted. */
export class ServiceDisplayFieldsDto {
  @ApiPropertyOptional({ example: 'এসি রিপেয়ার এন্ড সার্ভিস' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameBn?: string;

  @ApiPropertyOptional({ example: 'https://images.example.com/ac-repair.jpg' })
  @IsOptional()
  // require_tld off: an upload link on a dev server is http://localhost:5000/..., which has no top-level domain.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['বেসিক সার্ভিসিং', 'মাস্টার সার্ভিসিং'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  features?: string[];

  /** FIXED = not countable; PER_UNIT / PER_SQFT = the customer picks how many when ordering. */
  @ApiPropertyOptional({ enum: PriceUnit, example: PriceUnit.PER_UNIT })
  @IsOptional()
  @IsEnum(PriceUnit)
  priceUnit?: PriceUnit;
}

export class CreateServiceDto extends ServiceDisplayFieldsDto {
  @ApiProperty({ example: 'Split AC Basic Servicing' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Filter cleaning, gas checking and indoor wash' })
  @IsString()
  @IsNotEmpty()
  description!: string;

  @ApiProperty({ example: 800 })
  @IsNumber()
  @IsNotEmpty()
  basePrice!: number;

  @ApiProperty({ example: 45 })
  @IsNumber()
  @IsOptional()
  durationMin?: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  @IsOptional()
  isFixedPrice?: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  @IsOptional()
  isPopular?: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @ApiProperty({ example: 'category-uuid-here' })
  @IsUUID()
  @IsNotEmpty()
  categoryId!: string;
}

export class UpdateServiceDto extends ServiceDisplayFieldsDto {
  @ApiProperty({ example: 'Split AC Basic Servicing' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'Filter cleaning, gas checking and indoor wash' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 800 })
  @IsNumber()
  @IsOptional()
  basePrice?: number;

  @ApiProperty({ example: 45 })
  @IsNumber()
  @IsOptional()
  durationMin?: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  @IsOptional()
  isFixedPrice?: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  @IsOptional()
  isPopular?: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @ApiProperty({ example: 'category-uuid-here' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;
}

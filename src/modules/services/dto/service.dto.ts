import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** What the public service page shows besides the name and description. */
export class ServiceDisplayFieldsDto {
  @ApiPropertyOptional({ example: 'এসি রিপেয়ার এন্ড সার্ভিস' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameBn?: string;

  @ApiPropertyOptional({ example: 'https://images.example.com/ac-repair.jpg' })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
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

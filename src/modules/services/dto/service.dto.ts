import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateServiceDto {
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

export class UpdateServiceDto {
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

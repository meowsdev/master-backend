import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class AnswerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  questionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  optionId!: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  count?: number;
}

/** What affects the price. Shared by the live quote and the final order. */
export class QuoteOrderDto {
  /** The chosen sub-service (the "problem"); its main service is derived from it. */
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional({ minimum: 1, default: 1, description: 'Units (ACs, fans, ...) when the sub-service is priced per unit' })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ type: [AnswerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers?: AnswerDto[];
}

/** Deliberately has no price field: the backend works the price out itself. */
export class PlaceOrderDto extends QuoteOrderDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty()
  @IsInt()
  districtId!: number;

  @ApiProperty()
  @IsInt()
  upazilaId!: number;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MaxLength(300)
  addressDetail!: string;

  @ApiProperty({ example: '2026-11-20' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate must be YYYY-MM-DD' })
  scheduledDate!: string;

  @ApiProperty({ example: '09:00 AM - 11:00 AM' })
  @IsString()
  timeSlot!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  imageUrls?: string[];
}

/** An order an admin places for a customer who did not order through the app. */
export class AdminPlaceOrderDto extends PlaceOrderDto {
  @ApiProperty({ example: '+8801712345678', description: 'The customer; created as a customer account if the number is new' })
  @IsPhoneNumber()
  customerPhone!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerName?: string;
}

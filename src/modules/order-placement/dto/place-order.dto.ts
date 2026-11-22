import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Matches,
  Max,
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

/** The admin's New order form asks who a number is before the order is placed. */
export class CustomerLookupQueryDto {
  @ApiProperty({ example: '+8801712345678' })
  @IsPhoneNumber()
  phone!: string;
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

/** Bounds for a custom order's price, in BDT: stops a typo like 250000 instead of 2500. */
export const MIN_CUSTOM_ORDER_PRICE = 1;
export const MAX_CUSTOM_ORDER_PRICE = 200000;

/**
 * An admin's order for a service that is not in the catalog: the admin types the main service, the sub-service,
 * the details and the price. Everything else (customer, place, time) is the same as any admin order.
 */
export class AdminCustomOrderDto {
  @ApiProperty({ example: '+8801712345678', description: 'The customer; created as a customer account if the number is new' })
  @IsPhoneNumber()
  customerPhone!: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerName?: string;

  @ApiProperty({ example: 'Generator', maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  mainServiceName!: string;

  @ApiProperty({ example: 'Generator servicing', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subServiceName!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ example: 2500, minimum: MIN_CUSTOM_ORDER_PRICE, maximum: MAX_CUSTOM_ORDER_PRICE })
  @IsInt()
  @Min(MIN_CUSTOM_ORDER_PRICE)
  @Max(MAX_CUSTOM_ORDER_PRICE)
  price!: number;

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
}

/** One option in the cart. */
export class CartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  variantId!: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

/** A cart of one main service's options. Shared by the live quote and the order. */
export class QuoteCartDto {
  @ApiProperty({ format: 'uuid', description: 'The main service (chat) the cart belongs to' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ type: [CartItemDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];

  @ApiPropertyOptional({ type: [AnswerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers?: AnswerDto[];
}

/** Where and when: the same for a cart order and a custom order. */
export class OrderPlaceFieldsDto {
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

/** Deliberately has no price field: the backend works the price out itself. */
export class PlaceCartOrderDto extends OrderPlaceFieldsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ type: [CartItemDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items!: CartItemDto[];

  @ApiPropertyOptional({ type: [AnswerDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers?: AnswerDto[];

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

/** The customer's Custom card: a problem not in the catalog. No price; the provider quotes after a free visit. */
export class CustomerCustomOrderDto extends OrderPlaceFieldsDto {
  @ApiProperty({ format: 'uuid', description: 'The main service the problem belongs to' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;
}

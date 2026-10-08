import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMode } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class InChatBookingDto {
  @ApiProperty({
    format: 'uuid',
    example: '2f3fc9b0-fdf7-4c8b-a84b-d8aa8afdb76e',
  })
  @IsUUID()
  conversationId!: string;

  @ApiProperty({
    format: 'uuid',
    example: '5d25577d-aef6-499f-9554-8415054a9ef3',
  })
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '322a0ba0-62ce-4729-aa77-1ad8c1b0bc92',
  })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({ example: 1800, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  customPrice?: number;

  @ApiPropertyOptional({ example: 'House 12, Road 4, Dhanmondi, Dhaka' })
  @IsOptional()
  @IsString()
  addressText?: string;

  @ApiPropertyOptional({ example: 'Today, Within 2 Hours' })
  @IsOptional()
  @IsString()
  preferredTime?: string;

  @ApiPropertyOptional({ example: 'Please bring ladder and gas pressure gauge' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    enum: PaymentMode,
    default: PaymentMode.CASH,
  })
  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;
}

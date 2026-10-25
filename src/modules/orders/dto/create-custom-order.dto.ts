import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateCustomOrderDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: '6e7f4f75-d1dc-49eb-90ad-854d8fe363d0',
  })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '87af2a7b-8d14-4f6e-a2d9-469d5f51855e',
  })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: 'c1b5f10e-656a-4d4f-8f63-7c5d60fb3d5d',
  })
  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @ApiProperty({
    format: 'uuid',
    example: '4d2d7c40-9f10-4a94-9c44-4cc3fbb81f67',
  })
  @IsUUID()
  serviceId!: string;

  @ApiProperty({ example: 1000, minimum: 0 })
  @IsNumber()
  @Min(0)
  originalPrice!: number;

  @ApiPropertyOptional({ example: 100, minimum: 0, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  adminCommission?: number;

  @ApiPropertyOptional({ example: 200, minimum: 0, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  additionalPrice?: number;

  @ApiPropertyOptional({ example: 500, minimum: 0, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  advancePaid?: number;
}

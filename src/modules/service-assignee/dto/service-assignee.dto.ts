import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class CreateServiceAssigneeDto {
  @ApiProperty({
    format: 'uuid',
    example: '6e7f4f75-d1dc-49eb-90ad-854d8fe363d0',
  })
  @IsUUID()
  userId!: string;

  @ApiProperty({
    format: 'uuid',
    example: '4d2d7c40-9f10-4a94-9c44-4cc3fbb81f67',
  })
  @IsUUID()
  serviceId!: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateServiceAssigneeDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SyncMySkillsDto {
  @ApiProperty({
    type: [String],
    example: ['4d2d7c40-9f10-4a94-9c44-4cc3fbb81f67'],
    description: 'Array of service IDs selected by provider as skills',
  })
  @IsArray()
  @IsUUID('4', { each: true })
  serviceIds!: string[];
}

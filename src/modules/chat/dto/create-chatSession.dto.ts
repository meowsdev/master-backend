import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class CreateChatSessionDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: '4d2d7c40-9f10-4a94-9c44-4cc3fbb81f67',
  })
  @IsString()
  @IsOptional()
  serviceId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '87af2a7b-8d14-4f6e-a2d9-469d5f51855e',
  })
  @IsString()
  @IsOptional()
  customerProfileId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '322a0ba0-62ce-4729-aa77-1ad8c1b0bc92',
  })
  @IsString()
  @IsOptional()
  providerId?: string;
}

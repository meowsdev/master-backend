import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RevisionStatus } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateServiceRevisionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({ example: 'AC is not cooling after servicing' })
  @IsString()
  issueDescription!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://example.com/a.jpg'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachedImages?: string[];

  @ApiPropertyOptional({
    enum: RevisionStatus,
    example: RevisionStatus.REQUESTED,
  })
  @IsOptional()
  @IsEnum(RevisionStatus)
  revisionStatus?: RevisionStatus;

  @ApiPropertyOptional({ example: '2026-10-12T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  warrantyExpiresAt?: string;
}

export class UpdateServiceRevisionDto {
  @ApiPropertyOptional({ example: 'Updated issue details' })
  @IsOptional()
  @IsString()
  issueDescription?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://example.com/a.jpg'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachedImages?: string[];

  @ApiPropertyOptional({
    enum: RevisionStatus,
    example: RevisionStatus.ACCEPTED,
  })
  @IsOptional()
  @IsEnum(RevisionStatus)
  revisionStatus?: RevisionStatus;

  @ApiPropertyOptional({ example: '2026-10-12T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  warrantyExpiresAt?: string;
}

export class PostRevisionFeedbackeDto {
  @ApiProperty({
    example: false,
    description: 'Whether customer wants to continue with thie provider',
  })
  @IsBoolean()
  continueWithProvider: boolean;
}

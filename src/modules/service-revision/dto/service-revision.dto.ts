import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RevisionStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateServiceRevisionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orderId!: string;

  /** What is wrong. The status and the warranty end are decided by the server. */
  @ApiProperty({ example: 'AC is not cooling after servicing' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  issueDescription!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://example.com/a.jpg'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  attachedImages?: string[];
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

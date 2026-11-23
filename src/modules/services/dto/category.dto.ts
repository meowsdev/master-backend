import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCategoryDto {
  @ApiProperty({ example: 'AC Repair Services' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Left out, it is made from the name. */
  @ApiProperty({ example: 'ac-repair-services', required: false })
  @IsString()
  @IsOptional()
  slug?: string;

  @ApiProperty({
    example: 'All kinds of AC servicing & repair',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'https://example.com/icon.png', required: false })
  @IsString()
  @IsOptional()
  iconUrl?: string;

  /** The top-bar category (ServiceGroup) the new main service sits in. */
  @ApiProperty({ required: false, format: 'uuid' })
  @IsUUID()
  @IsOptional()
  groupId?: string;
}

export class UpdateCategoryDto {
  @ApiProperty({ example: 'AC Repair Services' })
  @IsString()
  @IsOptional()
  name!: string;

  @ApiProperty({ example: 'ac-repair-services' })
  @IsString()
  @IsOptional()
  slug!: string;

  @ApiProperty({
    example: 'All kinds of AC servicing & repair',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 'https://example.com/icon.png', required: false })
  @IsString()
  @IsOptional()
  iconUrl?: string;
}

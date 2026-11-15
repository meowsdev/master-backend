import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CompleteProfileDto {
  @ApiPropertyOptional({
    example: 'monir@example.com',
    description: 'User email address. Must be unique.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'Monir Hosin',
    description: 'User full name.',
  })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({
    example: 'monir_hosin',
    description:
      'Unique handle: 3-20 characters, lowercase letters, digits and underscore.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_]{3,20}$/, {
    message:
      'username must be 3-20 characters: lowercase letters, digits or underscore',
  })
  username?: string;

  @ApiPropertyOptional({ example: 47, description: 'District id (optional). null clears the location.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  districtId?: number | null;

  @ApiPropertyOptional({
    example: 330,
    description: 'Upazila id. Must belong to districtId.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  upazilaId?: number | null;

  @ApiPropertyOptional({
    example: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
    description: 'User profile photo URL.',
  })
  @IsOptional()
  @IsString()
  profilePhoto?: string;

  @ApiPropertyOptional({
    enum: UserRole,
    example: UserRole.CUSTOMER,
    description: 'User role. A matching profile will be created automatically.',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class SwitchProfileDto {
  @ApiProperty({
    enum: [UserRole.CUSTOMER, UserRole.PROVIDER, UserRole.COUNSELOR],
    example: UserRole.PROVIDER,
    description: 'Switch current active profile for this user.',
  })
  @IsEnum(UserRole)
  role!: UserRole;
}

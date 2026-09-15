import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export class CompleteProfileDto {
  @ApiPropertyOptional({
    example: 'alif@example.com',
    description: 'User email address. Must be unique.',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'Alif Khan',
    description: 'User full name.',
  })
  @IsOptional()
  @IsString()
  fullName?: string;

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

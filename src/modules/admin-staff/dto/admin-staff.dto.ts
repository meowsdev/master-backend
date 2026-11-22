import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, MaxLength } from 'class-validator';

const STAFF_ROLES = ['MANAGER', 'SUPPORT', 'HR', 'COUNSELOR'] as const;
export type GrantableStaffRole = (typeof STAFF_ROLES)[number];

/** Admin adds an office staff member: their number (they sign in with OTP on it), name and position. */
export class CreateStaffDto {
  @ApiProperty({ example: '+8801712345678' })
  @IsString()
  @IsPhoneNumber()
  mobileNumber!: string;

  @ApiProperty({ example: 'Rahim Uddin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ enum: STAFF_ROLES })
  @IsIn(STAFF_ROLES)
  role!: GrantableStaffRole;
}

/** Admin changes a staff member's position, or turns their account off / on. */
export class UpdateStaffDto {
  @ApiPropertyOptional({ enum: STAFF_ROLES })
  @IsOptional()
  @IsIn(STAFF_ROLES)
  role?: GrantableStaffRole;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'], description: 'SUSPENDED signs them out and keeps them out' })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED'])
  status?: 'ACTIVE' | 'SUSPENDED';
}

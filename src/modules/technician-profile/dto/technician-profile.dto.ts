import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Admin creates a technician account (a technician never signs themselves up). */
export class AdminCreateTechnicianDto {
  @ApiProperty({ example: '+8801700000000', description: 'Technician phone number with country code' })
  @IsString()
  @IsPhoneNumber()
  mobileNumber!: string;

  @ApiProperty({ example: 'Rahim Uddin' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '4d2d7c40-9f10-4a94-9c44-4cc3fbb81f67',
    description: 'Provider agency the technician works under',
  })
  @IsOptional()
  @IsUUID()
  providerAgencyId?: string;
}

/** Admin attaches a technician to a provider agency, or detaches with null. */
export class AssignTechnicianAgencyDto {
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    example: '4d2d7c40-9f10-4a94-9c44-4cc3fbb81f67',
  })
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  providerAgencyId!: string | null;
}

/** The only thing a technician may change about their own profile. */
export class UpdateMyTechnicianLocationDto {
  @ApiPropertyOptional({ example: 23.7465, minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  currentLat?: number;

  @ApiPropertyOptional({ example: 90.376, minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  currentLong?: number;
}

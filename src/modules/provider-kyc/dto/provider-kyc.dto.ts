import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Someone in the family to call when the provider cannot be reached on their own number. */
export class EmergencyContactDto {
  @ApiProperty({ example: 'Abdul Karim' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;

  @ApiProperty({ example: 'বাবা' })
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  relation!: string;

  @ApiProperty({ example: '+8801712345678' })
  @IsString()
  @MaxLength(20)
  phone!: string;
}

/** The provider's verification form. File keys come from POST /provider-kyc/me/documents. */
export class SubmitProviderKycDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) fullName!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) fatherName!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(100) motherName!: string;
  @ApiProperty({ enum: ['MALE', 'FEMALE', 'OTHER'] })
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender!: 'MALE' | 'FEMALE' | 'OTHER';
  /** Ignored: the phone is always the login number. Accepted only so an older app version still validates. */
  @ApiPropertyOptional({ deprecated: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;
  @ApiProperty({ example: '1207', description: '4 digits' })
  @IsString()
  @MaxLength(4)
  postCode!: string;
  @ApiProperty() @Type(() => Number) @IsInt() districtId!: number;
  @ApiProperty() @Type(() => Number) @IsInt() upazilaId!: number;
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  addressDetail!: string;
  @ApiProperty({ description: '10, 13 or 17 digits' })
  @IsString()
  @MaxLength(17)
  nidNumber!: string;
  @ApiProperty() @IsString() @MaxLength(120) nidFrontKey!: string;
  @ApiProperty() @IsString() @MaxLength(120) nidBackKey!: string;
  @ApiProperty() @IsString() @MaxLength(120) selfieKey!: string;

  /** The provider read and accepted the provider terms (conduct and liability) shown before sending. */
  @ApiProperty({ enum: [true] })
  @IsIn([true], {
    message: 'Accept the provider terms to send your verification',
  })
  acceptTerms!: true;

  /** Which version of the terms they saw, kept with the acceptance. */
  @ApiProperty({ example: '2026-11-27' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  termsVersion!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tradeLicenseNo?: string;

  @ApiProperty({ type: [EmergencyContactDto], minItems: 2, maxItems: 3 })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => EmergencyContactDto)
  emergencyContacts!: EmergencyContactDto[];
}

/** Admin's decision. A rejection needs a reason the provider can act on. */
export class ReviewProviderKycDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ example: 'NID back picture is blurry' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

/** One upazila an admin sets as a work area for the provider (with its district). */
export class AdminServiceAreaDto {
  @Type(() => Number) @IsInt() districtId!: number;
  @Type(() => Number) @IsInt() upazilaId!: number;
}

/**
 * Admin: a provider's whole KYC, entered on their behalf and verified at once. The same fields as the provider's own
 * form, without the terms (the provider accepts those themselves on their first visit), plus their work areas.
 */
export class AdminVerifyProviderKycDto extends OmitType(SubmitProviderKycDto, [
  'acceptTerms',
  'termsVersion',
  'contactPhone',
] as const) {
  @ApiPropertyOptional({
    type: [AdminServiceAreaDto],
    description: 'Replaces the work areas; leave out to keep them',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => AdminServiceAreaDto)
  serviceAreas?: AdminServiceAreaDto[];
}

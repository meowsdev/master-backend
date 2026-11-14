import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Cookie sessions send no body at all; the field exists only so legacy
 * (technician) sessions, which still hold their token client-side, keep working.
 */
export class RefreshTokenDto {
  @IsOptional()
  @IsString()
  @MinLength(20)
  refreshToken?: string;
}

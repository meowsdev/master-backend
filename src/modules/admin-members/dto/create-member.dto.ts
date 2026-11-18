import { IsIn, IsInt, IsOptional, IsPhoneNumber, IsString, MaxLength } from 'class-validator';

/** An admin adds a provider or a customer by phone number. (Technicians have their own endpoint.) */
export class CreateMemberDto {
  @IsIn(['PROVIDER', 'CUSTOMER'])
  role!: 'PROVIDER' | 'CUSTOMER';

  @IsString()
  @IsPhoneNumber()
  mobileNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  /** Providers only: the business name customers see. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string;

  /** Both or none. A provider's district and upazila also become the area they take orders in. */
  @IsOptional()
  @IsInt()
  districtId?: number;

  @IsOptional()
  @IsInt()
  upazilaId?: number;
}

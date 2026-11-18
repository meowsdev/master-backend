import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class OpenSupportThreadDto {
  @IsUUID()
  memberId!: string;
}

export class SendSupportMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text!: string;
}

export class SupportDirectoryQueryDto {
  @IsIn(['PROVIDER', 'CUSTOMER'])
  role!: 'PROVIDER' | 'CUSTOMER';

  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;
}

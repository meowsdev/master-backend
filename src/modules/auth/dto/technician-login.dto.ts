import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsPhoneNumber, IsString } from 'class-validator';

export class TechnicianLoginDto {
  @ApiProperty({
    example: '+8801700000000',
    description: 'Technician phone number with country code',
  })
  @IsString()
  @IsPhoneNumber()
  phoneNumber!: string;

  @ApiProperty({
    example: '123456',
    description: 'Technician direct login password',
  })
  @IsString()
  @IsNotEmpty()
  password!: string;
}

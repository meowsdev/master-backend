import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateLegalEscalationDto {
  @ApiProperty({
    example: 'Fraudulent activity and material theft reported on site',
    description: 'Reason for escalating to legal and locking accounts',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiProperty({
    example: 'POLICE-GD-88392',
    description: 'Police GD or legal reference number if applicable',
    required: false,
  })
  @IsString()
  @IsOptional()
  policeGdNumber?: string;

  @ApiProperty({
    example: 'Locking both provider and orders pending police investigation.',
    description: 'Additional notes by admin or legal officer',
    required: false,
  })
  @IsString()
  @IsOptional()
  actionNotes?: string;
}

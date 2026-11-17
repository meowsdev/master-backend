import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { ONLINE_PAYMENT_METHODS } from '../../order-completion/dto/order-completion.dto';

export class PayDueDto {
  @ApiProperty({ enum: ONLINE_PAYMENT_METHODS })
  @IsIn(ONLINE_PAYMENT_METHODS)
  method!: (typeof ONLINE_PAYMENT_METHODS)[number];
}

import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, Max, Min } from 'class-validator';
import { ONLINE_PAYMENT_METHODS } from '../../order-completion/dto/order-completion.dto';

export class PayAdvanceDto {
  @ApiProperty({ example: 1000, minimum: 1 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10_000_000)
  amount!: number;

  @ApiProperty({ enum: ONLINE_PAYMENT_METHODS })
  @IsIn(ONLINE_PAYMENT_METHODS)
  method!: (typeof ONLINE_PAYMENT_METHODS)[number];
}

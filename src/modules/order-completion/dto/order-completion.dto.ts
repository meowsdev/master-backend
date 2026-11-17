import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';

export const COMPLETION_PAYMENT_MODES = ['CASH', 'ONLINE'] as const;
export const ONLINE_PAYMENT_METHODS = ['BKASH', 'NAGAD', 'CARD'] as const;
/** Upper bound for a tip, in BDT; stops a typo like 100000 from being charged. */
export const MAX_TIP_AMOUNT = 5000;

export class CompleteOrderDto {
  @ApiProperty({ enum: COMPLETION_PAYMENT_MODES })
  @IsIn(COMPLETION_PAYMENT_MODES)
  paymentMode!: (typeof COMPLETION_PAYMENT_MODES)[number];
}

export class PayOnlineDto {
  @ApiProperty({ enum: ONLINE_PAYMENT_METHODS })
  @IsIn(ONLINE_PAYMENT_METHODS)
  method!: (typeof ONLINE_PAYMENT_METHODS)[number];

  @ApiPropertyOptional({ example: 100, minimum: 0, maximum: MAX_TIP_AMOUNT })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_TIP_AMOUNT)
  tipAmount?: number;
}

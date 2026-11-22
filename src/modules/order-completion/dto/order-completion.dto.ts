import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const COMPLETION_PAYMENT_MODES = ['CASH', 'ONLINE'] as const;
export const ONLINE_PAYMENT_METHODS = ['BKASH', 'NAGAD', 'CARD'] as const;
/** Upper bound for a tip, in BDT; stops a typo like 100000 from being charged. */
export const MAX_TIP_AMOUNT = 5000;

export class CompleteOrderDto {
  @ApiProperty({ enum: COMPLETION_PAYMENT_MODES })
  @IsIn(COMPLETION_PAYMENT_MODES)
  paymentMode!: (typeof COMPLETION_PAYMENT_MODES)[number];

  /** Cash only: what the customer handed over as a tip. An online tip is paid in the app, not reported here. */
  @ApiPropertyOptional({ example: 100, minimum: 0, maximum: MAX_TIP_AMOUNT })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_TIP_AMOUNT)
  tipAmount?: number;
}

export class FinishRevisionDto {
  /** Why the order came back after it was completed, in the provider's / technician's words. */
  @ApiProperty({ example: 'Gas pressure was low; the first service missed a small leak.' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  reason!: string;

  /** Was the first job's quality the cause? Kept for the provider's quality record. */
  @ApiProperty({ example: true })
  @IsBoolean()
  wasQualityIssue!: boolean;

  /** Needed only when extra charges were approved during the revision (money is still due). */
  @ApiPropertyOptional({ enum: COMPLETION_PAYMENT_MODES })
  @IsOptional()
  @IsIn(COMPLETION_PAYMENT_MODES)
  paymentMode?: (typeof COMPLETION_PAYMENT_MODES)[number];
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

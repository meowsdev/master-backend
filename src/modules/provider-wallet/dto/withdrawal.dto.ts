import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';

export const PAYOUT_METHODS = ['BKASH', 'NAGAD', 'BANK'] as const;
export const WITHDRAWAL_STATUSES = ['PENDING', 'PAID', 'REJECTED', 'CANCELLED'] as const;

/** A provider asks for money from their wallet. bKash / Nagad: an 11-digit mobile number. Bank: account, bank and branch. */
export class RequestWithdrawalDto {
  @ApiProperty({ description: 'Whole taka' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiProperty({ enum: PAYOUT_METHODS })
  @IsIn(PAYOUT_METHODS)
  method!: (typeof PAYOUT_METHODS)[number];

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @ValidateIf((dto: RequestWithdrawalDto) => dto.method !== 'BANK')
  @Matches(/^01[3-9]\d{8}$/, { message: 'Enter the 11-digit bKash / Nagad number, e.g. 01712345678' })
  accountNumber!: string;

  @ApiProperty({ description: 'The name on the account' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  accountName!: string;

  @ApiPropertyOptional({ description: 'BANK only' })
  @ValidateIf((dto: RequestWithdrawalDto) => dto.method === 'BANK')
  @IsString()
  @IsNotEmpty({ message: 'Enter the bank name' })
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ description: 'BANK only' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  branchName?: string;
}

export class ListWithdrawalsQuery {
  @ApiPropertyOptional({ enum: WITHDRAWAL_STATUSES })
  @IsOptional()
  @IsIn(WITHDRAWAL_STATUSES)
  status?: (typeof WITHDRAWAL_STATUSES)[number];
}

/** Admin: the money was sent outside the app; the transaction id shows where. */
export class MarkWithdrawalPaidDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  transactionRef!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RejectWithdrawalDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

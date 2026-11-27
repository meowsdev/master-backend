import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ExpenseItemDto {
  @ApiProperty({ example: 'Compressor capacitor (bought)' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  label!: string;

  /** 0 is allowed on review: the admin can strike an item out without deleting the line. */
  @ApiProperty({ example: 650, minimum: 0 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  amount!: number;
}

/** Provider / technician: what was spent on the job. */
export class SubmitExpenseClaimDto {
  @ApiProperty({ type: [ExpenseItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExpenseItemDto)
  items!: ExpenseItemDto[];
}

/** Admin: the amounts after review (raised or lowered), and an optional note to the provider. */
export class ApproveExpenseClaimDto {
  @ApiProperty({ type: [ExpenseItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExpenseItemDto)
  items!: ExpenseItemDto[];

  @ApiPropertyOptional({ example: 'Capacitor price checked: 550 in market' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** Sending costs back: a note on what to fix and, optionally, the amounts the reviewer thinks are right. */
export class RejectExpenseClaimDto {
  @ApiPropertyOptional({ type: [ExpenseItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExpenseItemDto)
  items?: ExpenseItemDto[];

  @ApiPropertyOptional({ example: 'No receipt for the parts' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class TermsSectionDto {
  @ApiProperty({ example: '২. আচরণ: শূন্য সহনশীলতা' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  heading!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  points!: string[];
}

/** Admin: the full text of a new version of the provider terms. */
export class PublishProviderTermsDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title!: string;

  @ApiProperty({ type: [TermsSectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => TermsSectionDto)
  sections!: TermsSectionDto[];
}

/** Provider: the version they read and accept. */
export class AcceptProviderTermsDto {
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;
}

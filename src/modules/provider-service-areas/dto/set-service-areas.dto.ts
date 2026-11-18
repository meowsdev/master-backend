import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, ValidateNested } from 'class-validator';

export class ServiceAreaDto {
  @IsInt()
  districtId!: number;

  @IsInt()
  upazilaId!: number;
}

export class SetServiceAreasDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ServiceAreaDto)
  areas!: ServiceAreaDto[];
}

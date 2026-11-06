import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SaleCategoryQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;
}

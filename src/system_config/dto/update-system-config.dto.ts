import { IsString, IsOptional, IsNumber } from 'class-validator';

export class UpdateSystemConfigDto {
  @IsString()
  @IsOptional()
  display_name?: string;

  @IsString()
  @IsOptional()
  value?: string;

  @IsString()
  @IsOptional()
  type?: string;

  @IsString()
  @IsOptional()
  section?: string;

  @IsNumber()
  @IsOptional()
  status?: number;
}

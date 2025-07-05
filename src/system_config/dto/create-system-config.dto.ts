import { IsString, IsOptional, IsNumber, IsNotEmpty } from 'class-validator';

export class CreateSystemConfigDto {
  @IsString()
  @IsNotEmpty()
  name: string;

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
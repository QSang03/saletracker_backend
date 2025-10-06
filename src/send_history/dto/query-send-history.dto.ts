import { IsOptional, IsString, IsInt } from 'class-validator';
import { Transform } from 'class-transformer';

export class QuerySendHistoryDto {
  @IsOptional()
  @IsString()
  zalo_customer_id?: string;

  @IsOptional()
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  @IsInt()
  user_id?: number;

  @IsOptional()
  @IsString()
  send_function?: string;

  @IsOptional()
  @IsString()
  from?: string; // ISO date string

  @IsOptional()
  @IsString()
  to?: string; // ISO date string

  @IsOptional()
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => value ? parseInt(value, 10) : undefined)
  @IsInt()
  pageSize?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

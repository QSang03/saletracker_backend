import {
  IsOptional,
  IsString,
  IsInt,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ActivityAction } from '../activity-log.entity';

export class QueryActivityLogDto {
  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  @IsInt()
  user_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  menu_path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  menu_group?: string;

  @IsOptional()
  @IsEnum(ActivityAction)
  action?: ActivityAction;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  entity_id?: string;

  @IsOptional()
  @IsString()
  from?: string; // ISO date string — chặn dưới

  @IsOptional()
  @IsString()
  to?: string; // ISO date string — chặn trên

  @IsOptional()
  @IsString()
  @MaxLength(191)
  search?: string;

  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  @IsInt()
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value ? parseInt(value, 10) : undefined))
  @IsInt()
  pageSize?: number;
}

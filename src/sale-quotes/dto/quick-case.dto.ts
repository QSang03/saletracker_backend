import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MATCH_TYPES, QUICK_CASE_STATUSES } from '../sale-quote.constants';
import { BaseQueryWithMineDto } from './common.dto';

export class QuickCaseItemInputDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  requestText?: string;

  @IsOptional()
  @IsIn(MATCH_TYPES as unknown as string[])
  matchType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  productCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  pn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salePrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  statusText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class CreateQuickCaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  globalNote?: string;

  @IsOptional()
  @IsIn(QUICK_CASE_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuickCaseItemInputDto)
  items?: QuickCaseItemInputDto[];
}

export class UpdateQuickCaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  customerPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  globalNote?: string;

  @IsOptional()
  @IsIn(QUICK_CASE_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateQuickCaseItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  requestText?: string;

  @IsOptional()
  @IsIn(MATCH_TYPES as unknown as string[])
  matchType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  productCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  pn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salePrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  statusText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  note?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class QueryQuickCaseDto extends BaseQueryWithMineDto {
  @IsOptional()
  @IsIn(QUICK_CASE_STATUSES as unknown as string[])
  status?: string;
}

export class BulkQuickCaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsString()
  @MaxLength(20000)
  rawText: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  globalNote?: string;
}

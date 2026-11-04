import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
import { QUOTE_STATUSES } from '../sale-quote.constants';
import { BaseQueryWithMineDto } from './common.dto';

export const QUOTE_MODES = ['standard', 'build', 'single', 'customer'] as const;

export class QuoteItemInputDto {
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
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  warranty?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number | null;

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

  @IsOptional()
  @IsBoolean()
  isManual?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class CreateQuoteDto {
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
  @MaxLength(500)
  customerAddress?: string;

  @IsOptional()
  @IsIn(QUOTE_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsIn(QUOTE_MODES as unknown as string[])
  mode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  globalNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  zaloSuffix?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteItemInputDto)
  items?: QuoteItemInputDto[];
}

export class UpdateQuoteDto {
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
  @MaxLength(500)
  customerAddress?: string;

  @IsOptional()
  @IsIn(QUOTE_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsIn(QUOTE_MODES as unknown as string[])
  mode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  globalNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  zaloSuffix?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateQuoteItemDto {
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
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  warranty?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPrice?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number | null;

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

  @IsOptional()
  @IsBoolean()
  isManual?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class QueryQuoteDto extends BaseQueryWithMineDto {
  @IsOptional()
  @IsIn(QUOTE_STATUSES as unknown as string[])
  status?: string;

  @IsOptional()
  @IsIn(QUOTE_MODES as unknown as string[])
  mode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleUserId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  dateFrom?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  dateTo?: string;
}

export class QuoteTextQueryDto {
  @IsOptional()
  @IsIn(QUOTE_MODES as unknown as string[])
  mode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  zaloSuffix?: string;
}

export class QuoteExportQueryDto {
  @IsOptional()
  @IsIn(['internal', 'customer'])
  type?: 'internal' | 'customer';
}

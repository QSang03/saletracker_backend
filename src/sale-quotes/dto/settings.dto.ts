import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { toBoolean } from './common.dto';

export class PricingRulesDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lowPriceThreshold?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  lowPriceMargin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  highPriceMarkupPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  customerMarkupPercent?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  roundTo?: number;
}

export class UpdateSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PricingRulesDto)
  pricingRules?: PricingRulesDto;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  defaultWarranty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultStatusText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  defaultGlobalNote?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  zaloSuffix?: string;
}

export class CatalogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  brand?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  sort?: string;
}

export class PricingPreviewItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  productId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class PricingPreviewDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PricingPreviewItemDto)
  items: PricingPreviewItemDto[];
}

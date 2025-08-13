import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class RouteProductDto {
  @IsNumber()
  productId: number;

  @IsOptional()
  @IsNumber()
  priority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class CreateKeywordDto {
  @IsString()
  @IsNotEmpty()
  keyword: string;

  @IsOptional()
  @IsNumber()
  contactId?: number | null;

  @ValidateNested({ each: true })
  @Type(() => RouteProductDto)
  routeProducts: RouteProductDto[];
}

export class BulkCreateKeywordDto {
  @IsString()
  @IsNotEmpty()
  keyword: string;

  @IsArray()
  @IsNumber({}, { each: true })
  contactIds: number[];

  @IsArray()
  @IsNumber({}, { each: true })
  productIds: number[];

  @IsOptional()
  @IsNumber()
  defaultPriority?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class PatchKeywordDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  routeProducts?: Array<{ id: number; priority?: number; active?: boolean }>;
}

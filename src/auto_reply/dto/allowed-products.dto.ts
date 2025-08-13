import { IsArray, IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class PatchAllowedProductsDto {
  @IsArray()
  @IsNumber({}, { each: true })
  productIds: number[];

  @IsBoolean()
  active: boolean;
}

export class BulkAllowedProductsDto {
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  contactIds?: number[] | 'ALL';

  @IsArray()
  @IsNumber({}, { each: true })
  productIds: number[];

  @IsBoolean()
  active: boolean;
}

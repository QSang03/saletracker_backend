import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  ValidateIf,
} from 'class-validator';

export class PatchAllowedProductsDto {
  @IsArray()
  @IsNumber({}, { each: true })
  productIds: number[];

  @IsBoolean()
  active: boolean;
}

export class BulkAllowedProductsDto {
  @IsOptional()
  @ValidateIf((o) => Array.isArray(o.contactIds))
  @IsArray()
  @ValidateIf((o) => Array.isArray(o.contactIds))
  @IsNumber({}, { each: true })
  @ValidateIf((o) => typeof o.contactIds === 'string')
  @IsIn(['ALL'])
  contactIds?: number[] | 'ALL';

  @IsArray()
  @IsNumber({}, { each: true })
  productIds: number[];

  @IsBoolean()
  active: boolean;
}

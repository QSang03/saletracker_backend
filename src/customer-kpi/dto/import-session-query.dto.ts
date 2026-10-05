import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ImportSessionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;

  @IsOptional()
  @IsIn(['pending_review', 'applied', 'cancelled', 'rolled_back'])
  status?: 'pending_review' | 'applied' | 'cancelled' | 'rolled_back';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}

/** Đặt quyết định Giữ/Bỏ cho một thay đổi trong session import. */
export class ChangeDecisionDto {
  @IsIn(['apply', 'skip'])
  decision: 'apply' | 'skip';
}

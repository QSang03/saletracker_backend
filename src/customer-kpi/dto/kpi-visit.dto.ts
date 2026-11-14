import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const PERIOD_KEY_REGEX = /^(\d{4}-(0[1-9]|1[0-2])|\d{4}-Q[1-4])$/;

/** GET /customer-kpi-reports/visit-coverage */
export class VisitCoverageQueryDto {
  /** Bắt buộc với admin/manager; sale mặc định chính mình. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  saleId?: number;

  /** Tháng cần xem, `YYYY-MM`; mặc định tháng hiện tại (giờ VN). */
  @IsOptional()
  @IsString()
  @Matches(MONTH_REGEX, { message: 'period phải có dạng YYYY-MM' })
  period?: string;

  /** Quý tài chính; bỏ trống thì suy ra từ `period`. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  fiscal_year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quarter?: number;

  @IsOptional()
  @IsIn(['ALL', 'KEY', 'NON'])
  tier?: 'ALL' | 'KEY' | 'NON';

  /** Lọc danh sách khách theo kỳ `visitPeriod`. */
  @IsOptional()
  @IsIn(['all', 'visited', 'not_visited'])
  visited?: 'all' | 'visited' | 'not_visited';

  @IsOptional()
  @IsIn(['month', 'quarter'])
  visitPeriod?: 'month' | 'quarter';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

/** POST /customer-kpi-reports/visit-targets */
export class AssignVisitTargetDto {
  @IsIn(['department', 'sale'])
  scope: 'department' | 'sale';

  /** Bắt buộc khi scope=department. */
  @IsOptional()
  @IsString()
  department_slug?: string;

  /** Bắt buộc khi scope=sale; count chỉ cho phép gán theo sale. */
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  sale_ids?: number[];

  @IsIn(['month', 'quarter'])
  period_type: 'month' | 'quarter';

  /** `YYYY-MM` (tháng) hoặc `YYYY-QN` (quý tài chính). */
  @IsString()
  @Matches(PERIOD_KEY_REGEX, {
    message: 'period_key phải là YYYY-MM hoặc YYYY-QN',
  })
  period_key: string;

  @IsIn(['count', 'percent'])
  target_type: 'count' | 'percent';

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  target_value: number;

  @IsOptional()
  @IsIn(['ALL', 'KEY', 'NON'])
  customer_tier?: 'ALL' | 'KEY' | 'NON';
}

/** GET /customer-kpi-reports/visit-targets */
export class VisitTargetQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  saleId?: number;

  @IsOptional()
  @IsIn(['month', 'quarter'])
  period_type?: 'month' | 'quarter';

  @IsOptional()
  @IsString()
  @Matches(PERIOD_KEY_REGEX, {
    message: 'period_key phải là YYYY-MM hoặc YYYY-QN',
  })
  period_key?: string;
}

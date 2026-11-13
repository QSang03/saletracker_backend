import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

/** GET /customer-kpi-reports/monthly-results */
export class KpiMonthlyQueryDto {
  @IsOptional()
  @IsString()
  @Matches(PERIOD_REGEX, { message: 'period phải có dạng YYYY-MM' })
  period?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;
}

/** POST /customer-kpi-reports/monthly-results/compute */
export class ComputeMonthlyDto {
  @IsString()
  @Matches(PERIOD_REGEX, { message: 'period phải có dạng YYYY-MM' })
  period: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;

  /** Bắt buộc khi tính lại tháng đã có kết quả. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

/** PATCH /customer-kpi-reports/monthly-results/:id/bonus */
export class SetMonthlyBonusDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  bonusAmount: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

/** GET /customer-kpi-reports/quarter-settlements */
export class KpiQuarterQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscal_year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quarter?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;
}

/** POST /customer-kpi-reports/quarter-settlements/compute */
export class ComputeQuarterDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscal_year: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quarter: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;

  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

/** POST /customer-kpi-reports/quarter-settlements/finalize */
export class FinalizeQuarterDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscal_year: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quarter: number;

  @Type(() => Number)
  @IsInt()
  saleId: number;
}

/** POST /customer-kpi-reports/quarter-settlements/reopen */
export class ReopenQuarterDto extends FinalizeQuarterDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

/** GET /customer-kpi-reports/daily-tracking */
export class DailyTrackingQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscal_year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quarter?: number;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from phải có dạng YYYY-MM-DD',
  })
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to phải có dạng YYYY-MM-DD',
  })
  to?: string;
}

/** GET /customer-kpi-reports/care-funnel — cùng bộ lọc kỳ với daily-tracking. */
export class CareFunnelQueryDto extends DailyTrackingQueryDto {}

/** GET /customer-kpi-reports/sla-violations */
export class KpiSlaQueryDto {
  @IsOptional()
  @IsString()
  @Matches(PERIOD_REGEX, { message: 'period phải có dạng YYYY-MM' })
  period?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;

  @IsOptional()
  @IsString()
  customerCode?: string;

  /**
   * Ô tìm kiếm chung: khớp MỘT PHẦN (LIKE %...%) với tên/mã nhân viên sale,
   * tên/mã khách, hoặc tên hiển thị Zalo (`customer_zalo.matched_name`). Không
   * phân biệt hoa thường theo collation utf8mb4_unicode_ci của DB.
   */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['all', 'open', 'responded', 'none', 'waived'])
  status?: 'all' | 'open' | 'responded' | 'none' | 'waived';

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
  limit?: number;
}

/** GET /customer-kpi-reports/sla-summary */
export class KpiSlaSummaryQueryDto {
  @IsOptional()
  @IsString()
  @Matches(PERIOD_REGEX, { message: 'period phải có dạng YYYY-MM' })
  period?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;
}

/** POST /customer-kpi-appeals */
export class CreateKpiAppealDto {
  @Type(() => Number)
  @IsInt()
  violationId: number;

  @IsString()
  reason: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceUrls?: string[];
}

/** GET /customer-kpi-appeals */
export class KpiAppealQueryDto {
  @IsOptional()
  @IsString()
  @Matches(PERIOD_REGEX, { message: 'period phải có dạng YYYY-MM' })
  period?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';

  /** Khớp một phần tên/mã sale, tên/mã khách, tên Zalo hoặc nội dung lý do. */
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Phân trang TUỲ CHỌN: chỉ áp dụng khi truyền `page` hoặc `limit`; không
   * truyền thì trả toàn bộ kỳ (giữ tương thích FE cũ đang tự đếm theo tab).
   */
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
  limit?: number;
}

/** PATCH /customer-kpi-appeals/:id/review */
export class ReviewKpiAppealDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  reviewNote?: string;
}

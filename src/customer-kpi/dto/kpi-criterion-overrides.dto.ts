import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  MinLength,
} from 'class-validator';

/**
 * 2 tiêu chí hành vi cho phép quản lý ghi đè thủ công thành "chưa đạt":
 * tiêu chí 3 (đi hỗ trợ khách) và tiêu chí 4 (chủ động hỏi thăm). Các tiêu chí
 * khác (doanh số, gợi ý...) không có ghi đè.
 */
export const OVERRIDABLE_CRITERION_KEYS = [
  'support_khach',
  'lien_lac_phan_hoi',
] as const;

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CreateKpiCriterionOverrideDto {
  /** users.id của sale bị ghi đè. */
  @IsInt()
  @Type(() => Number)
  sale_id: number;

  /**
   * 0 (hoặc bỏ trống) = ghi đè CẢ DANH SÁCH của sale — mạnh nhất, áp mọi khách.
   * >0 = customers.id — ghi đè riêng một khách.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  customer_id?: number;

  @IsIn([...OVERRIDABLE_CRITERION_KEYS])
  criterion_key: string;

  /** `YYYY-MM` — mọi tháng đều cho ghi đè, không giới hạn quá khứ. */
  @Matches(MONTH_REGEX, { message: 'period_month phải theo định dạng YYYY-MM' })
  period_month: string;

  /** Bắt buộc — để truy vết khi sale/khách khiếu nại. */
  @IsString()
  @MinLength(1)
  reason: string;
}

export class KpiCriterionOverrideQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;

  @IsOptional()
  @IsIn([...OVERRIDABLE_CRITERION_KEYS])
  criterionKey?: string;

  @IsOptional()
  @Matches(MONTH_REGEX, { message: 'periodMonth phải theo định dạng YYYY-MM' })
  periodMonth?: string;
}

import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export class KpiTargetQueryDto {
  @IsOptional()
  @IsString()
  criterion_key?: string;

  /** Định dạng YYYY-MM. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'period_month phải theo định dạng YYYY-MM',
  })
  period_month?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 100;
}

/** Chỉ tiêu riêng cho một khách hàng (dùng khi scope = customer). */
export class CustomerTargetItemDto {
  @Type(() => Number)
  @IsInt()
  customer_id: number;

  @Type(() => Number)
  @IsNumber()
  target_value: number;
}

/**
 * Giao chỉ tiêu theo tháng — một trong ba cách (thiết kế mục 5.1.7):
 *
 * | scope        | Trường cần điền                          | Kết quả |
 * |--------------|------------------------------------------|---------|
 * | department   | department_slug + target_value           | Tạo dòng cấp nhân viên (customer_id = 0) cho MỌI người trong phòng |
 * | sale         | sale_ids[] + target_value                | Tạo dòng cấp nhân viên cho từng người |
 * | customer     | sale_id + items[{customer_id, value}]    | Tạo dòng có customer_id cho từng khách |
 *
 * LƯU Ý PHÂN QUYỀN: admin nhập → áp dụng thẳng; trưởng phòng nhập cho người
 * trong phòng → tạo approval_requests (kpi_target) chờ quản trị viên duyệt.
 */
export class AssignKpiTargetsDto {
  @IsString()
  criterion_key: string;

  @Matches(/^\d{4}-\d{2}$/, {
    message: 'period_month phải theo định dạng YYYY-MM',
  })
  period_month: string;

  @IsIn(['department', 'sale', 'customer'])
  scope: 'department' | 'sale' | 'customer';

  @IsOptional()
  @IsString()
  department_slug?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  target_value?: number;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  sale_ids?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sale_id?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerTargetItemDto)
  items?: CustomerTargetItemDto[];
}

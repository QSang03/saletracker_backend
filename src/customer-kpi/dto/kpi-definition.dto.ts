import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateKpiDefinitionDto {
  /** Nhóm áp dụng: kinh-doanh | cong-no | ke-toan... */
  @IsOptional()
  @IsString()
  team_group?: string = 'kinh-doanh';

  /** Khóa tiêu chí, duy nhất trong nhóm, ví dụ `support_khach`. */
  @IsString()
  key: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Adapter xử lý: contacted_customers | responded_customers | revenue_key... */
  @IsString()
  metric: string;

  @IsEnum(['binary', 'ratio'])
  scoring_mode: 'binary' | 'ratio';

  /** Chỉ dùng khi scoring_mode = ratio. */
  @IsOptional()
  @IsEnum(['target_value', 'all_customers', 'reachable_customers'])
  denominator?: 'target_value' | 'all_customers' | 'reachable_customers';

  @IsOptional()
  @IsEnum(['day', 'week', 'month', 'quarter'])
  period?: 'day' | 'week' | 'month' | 'quarter';

  /** binary: ngưỡng đạt; ratio + denominator=target_value: chỉ tiêu mặc định. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  target_value?: number;

  /** Chỉ dùng khi scoring_mode = binary. */
  @IsOptional()
  @IsEnum(['gte', 'lte'])
  comparison?: 'gte' | 'lte';

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number = 0;
}

export class UpdateKpiDefinitionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  metric?: string;

  @IsOptional()
  @IsEnum(['binary', 'ratio'])
  scoring_mode?: 'binary' | 'ratio';

  @IsOptional()
  @IsEnum(['target_value', 'all_customers', 'reachable_customers'])
  denominator?: 'target_value' | 'all_customers' | 'reachable_customers';

  @IsOptional()
  @IsEnum(['day', 'week', 'month', 'quarter'])
  period?: 'day' | 'week' | 'month' | 'quarter';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  target_value?: number;

  @IsOptional()
  @IsEnum(['gte', 'lte'])
  comparison?: 'gte' | 'lte';

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_order?: number;
}

export class KpiDefinitionQueryDto {
  /** Lọc theo nhóm; bỏ trống = tất cả nhóm. */
  @IsOptional()
  @IsString()
  team_group?: string;

  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all' = 'active';
}

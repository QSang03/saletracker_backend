import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

const toBoolean = ({ value }: { value: any }) =>
  value === true || value === 1 || value === '1' || value === 'true';

export class CarePreviewDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true })
  order_ids: number[];

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  include_hidden?: boolean;
}

export class CareSendDto extends CarePreviewDto {
  @IsString()
  @Length(1, 2000)
  message_content: string;

  @IsString()
  @Length(8, 100)
  request_id: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  preset_id?: number;
}

export class CareHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 20;
}

export class CareStatsQueryDto {
  @IsOptional()
  @IsIn(['day', 'week', 'month', 'quarter', 'custom'])
  period?: string = 'month';

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsIn(['0', '1', 'all'])
  isProject?: string = '0';

  @IsOptional()
  @IsString()
  employees?: string;

  @IsOptional()
  @IsString()
  departments?: string;

  /** created = đơn tạo trong kỳ; all = toàn bộ đơn (dùng cho dự án lifetime). */
  @IsOptional()
  @IsIn(['created', 'all'])
  scope?: string = 'created';
}

export class SetProjectDto {
  @IsBoolean()
  is_project: boolean;
}

export class BulkSetProjectDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @Type(() => Number)
  @IsInt({ each: true })
  ids: number[];

  @IsBoolean()
  is_project: boolean;
}

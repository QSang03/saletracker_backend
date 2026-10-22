import {
  IsOptional,
  IsString,
  IsEnum,
  IsArray,
  IsObject,
  MaxLength,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ActivityAction } from '../activity-log.entity';

/**
 * Một sự kiện thao tác mà frontend gửi lên.
 *
 * Lưu ý: user_id KHÔNG nhận từ body — luôn lấy từ JWT để không thể giả mạo.
 * Global ValidationPipe chạy với whitelist: true nên field lạ sẽ bị loại bỏ.
 */
export class CreateActivityLogDto {
  @IsOptional()
  @IsString()
  @MaxLength(191)
  menu_path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  menu_title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  menu_group?: string;

  @IsOptional()
  @IsEnum(ActivityAction)
  action?: ActivityAction;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  entity_id?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  changed_fields?: string[];

  @IsOptional()
  @IsObject()
  old_values?: Record<string, any>;

  @IsOptional()
  @IsObject()
  new_values?: Record<string, any>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  occurred_at?: string;
}

/**
 * Gửi nhiều sự kiện cùng lúc (frontend gom theo batch để giảm số request).
 */
export class CreateActivityLogBatchDto {
  @IsArray()
  @ArrayMaxSize(50, { message: 'Mỗi lần gửi tối đa 50 sự kiện' })
  @ValidateNested({ each: true })
  @Type(() => CreateActivityLogDto)
  items: CreateActivityLogDto[];
}

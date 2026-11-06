import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MANUAL_BULK_TARGET_STATUSES,
  MAX_BULK_STATUS_IDS,
  OrderStatusValue,
} from '../order-status.constants';

export class BulkUpdateStatusDto {
  @IsArray({ message: 'ids phải là mảng' })
  @ArrayNotEmpty({ message: 'ids không được rỗng' })
  @ArrayMaxSize(MAX_BULK_STATUS_IDS, {
    message: `Tối đa ${MAX_BULK_STATUS_IDS} đơn mỗi lần cập nhật`,
  })
  @Type(() => Number)
  @IsInt({ each: true, message: 'ids phải là số nguyên' })
  @Min(1, { each: true, message: 'ids phải lớn hơn 0' })
  ids: number[];

  @IsIn(MANUAL_BULK_TARGET_STATUSES, {
    message: `status phải là một trong: ${MANUAL_BULK_TARGET_STATUSES.join(', ')}. cared/demand_cared chỉ được gán qua chức năng Chăm sóc`,
  })
  status: OrderStatusValue;

  @IsOptional()
  @IsString({ message: 'note phải là chuỗi' })
  @MaxLength(500, { message: 'note tối đa 500 ký tự' })
  note?: string;
}

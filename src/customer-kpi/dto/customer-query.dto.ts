import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Bộ lọc danh sách khách hàng.
 *
 * `saleId` bị SERVER GHI ĐÈ theo phạm vi đăng nhập (admin: tự chọn; manager:
 * người trong phòng; user: chỉ chính mình) — client truyền cũng chỉ là gợi ý.
 */
export class CustomerQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;

  /** Slug phòng ban: may-in | pc | linh-kien | laptop | ptkh1 | ptkh2 */
  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsIn(['KEY', 'NON'])
  tier?: 'KEY' | 'NON';

  @IsOptional()
  @IsIn(['CHINH', 'PHU'])
  role?: 'CHINH' | 'PHU';

  /** linked = đã tìm thấy tài khoản Zalo; unlinked = chưa tìm thấy. */
  @IsOptional()
  @IsIn(['linked', 'unlinked'])
  zaloStatus?: 'linked' | 'unlinked';

  /** Tìm theo mã hoặc tên khách hàng. */
  @IsOptional()
  @IsString()
  search?: string;

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

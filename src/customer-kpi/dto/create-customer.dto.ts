import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

/**
 * Thêm khách hàng bằng tay — tạo (hoặc tái sử dụng) khách + dòng phân công.
 * Phòng ban giới hạn trong 6 slug cố định của file Excel (Phụ lục A.4).
 *
 * Quy tắc ghi (theo thiết kế vai trò):
 * - admin        : tạo cho sale bất kỳ
 * - manager-<phòng>: tạo cho sale trong phòng ban của mình
 * - nhân viên    : tạo đề xuất → trưởng phòng duyệt (Mục 2)
 */
export class CreateCustomerDto {
  /** Mã khách hàng, ví dụ MBA_HNO_TH_THAKRALONE — trùng mã → 409. */
  @IsString()
  @Length(1, 64)
  customer_code: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  customer_name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  sap_code?: string;

  @IsOptional()
  @IsIn(['CHINH', 'PHU'])
  customer_role?: 'CHINH' | 'PHU';

  /** Số ngày công nợ (cột HẠN MỨC của Excel) — KHÔNG phải hạn mức tiền. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  credit_days?: number;

  /** may-in | pc | linh-kien | laptop | ptkh1 | ptkh2 */
  @IsIn(['may-in', 'pc', 'linh-kien', 'laptop', 'ptkh1', 'ptkh2'])
  department_slug: string;

  /** Sale nhận phân công. */
  @Type(() => Number)
  @IsInt()
  sale_id: number;

  @IsIn(['KEY', 'NON'])
  customer_tier: 'KEY' | 'NON';

  /** Tài khoản Zalo của sale — bỏ trống thì hệ thống tự tra theo sale_id. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  zalo_account_id?: number;
}

/** Đổi Key/Non hoặc Chính/Phụ cho NHIỀU dòng phân công cùng lúc. */
export class BulkUpdateCustomersDto {
  @IsArray()
  @IsNumber({}, { each: true })
  assignmentIds: number[];

  /** Cả hai đều tuỳ chọn nhưng phải có ít nhất một. */
  @IsOptional()
  @IsIn(['KEY', 'NON'])
  customer_tier?: 'KEY' | 'NON';

  /** Đổi trên customers — dùng chung toàn công ty, ảnh hưởng mọi sale phục vụ khách. */
  @IsOptional()
  @IsIn(['CHINH', 'PHU'])
  customer_role?: 'CHINH' | 'PHU';
}

/** Tham số tra cứu liên hệ Zalo của tài khoản — phục vụ chọn tay cặp khớp. */
export class ZaloContactQueryDto {
  /** Bỏ trống = tra mọi tài khoản Zalo thuộc phạm vi của bạn. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  accountId?: number;

  /** Tìm theo tên hiển thị (LIKE %search%). */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  /** Trang, bắt đầu từ 1 — mỗi trang tối đa `limit` dòng (API Python phân trang). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
}

import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

/**
 * Sửa tay một cặp khớp Zalo ↔ khách hàng (customer_zalo.id).
 *
 * Mọi thay đổi qua route này đều đặt `match_method = 'manual'` — job tự khớp
 * KHÔNG được ghi đè lại (thiết kế mục 4.3.2).
 */
export class UpdateZaloLinkDto {
  /** ID liên hệ Zalo mới (zalo_contacts.zalo_contact_id). */
  @IsOptional()
  @IsString()
  zalo_contact_id?: string;

  /** Tài khoản Zalo chứa liên hệ trên (bắt buộc đi kèm — mục 4.2). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  zalo_account_id?: number;

  @IsOptional()
  @IsString()
  matched_name?: string;

  /** false = ngừng tính tài khoản này vào KPI của khách. */
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

/**
 * Gắn tay một cặp khớp MỚI khi job không tìm ra (Mục 3 cv 2) — tạo dòng
 * customer_zalo với `match_method = 'manual'` ngay từ đầu.
 */
export class CreateZaloLinkDto {
  @Type(() => Number)
  @IsInt()
  assignment_id: number;

  /** ID liên hệ Zalo (zalo_contacts.zalo_contact_id) — bắt buộc kèm tài khoản. */
  @IsString()
  zalo_contact_id: string;

  /** Bỏ trống → tự tra tài khoản Zalo của sale của dòng phân công. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  zalo_account_id?: number;
}

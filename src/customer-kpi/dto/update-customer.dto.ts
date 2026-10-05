import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Sửa thông tin một dòng "khách hàng của tôi".
 *
 * QUAN TRỌNG: `:id` trên các route /customers là ID DÒNG PHÂN CÔNG
 * (customer_assignments.id) — vì tier Key/Non và phạm vi theo Sale đều nằm ở
 * dòng phân công, không phải ở bảng customers dùng chung.
 *
 * Quy tắc áp dụng (Mục 2 xây):
 * - admin / trưởng phòng: sửa thẳng.
 * - nhân viên: tạo đề xuất chờ trưởng phòng duyệt, chưa áp dụng ngay.
 */
export class UpdateCustomerDto {
  @IsOptional()
  @IsIn(['KEY', 'NON'])
  customer_tier?: 'KEY' | 'NON';

  @IsOptional()
  @IsIn(['CHINH', 'PHU'])
  customer_role?: 'CHINH' | 'PHU';

  @IsOptional()
  @IsString()
  customer_name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  debt_limit?: number;
}

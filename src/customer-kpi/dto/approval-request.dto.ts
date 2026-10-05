import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ApprovalRequestQueryDto {
  @IsOptional()
  @IsIn(['customer_list', 'kpi_target'])
  request_type?: 'customer_list' | 'kpi_target';

  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected'])
  status?: 'pending' | 'approved' | 'rejected';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}

/**
 * Quyết định của người duyệt.
 *
 * Quy tắc (thiết kế phần vai trò):
 * - customer_list: trưởng phòng duyệt đề xuất của nhân viên.
 * - kpi_target   : quản trị viên duyệt đề xuất của trưởng phòng.
 * Duyệt  = ghi các mục trong đề xuất vào dữ liệu thật (customer_assignments /
 * kpi_targets) + ghi nhật ký.
 * Từ chối = chỉ ghi lại lý do, không đổi dữ liệu.
 */
export class DecideApprovalDto {
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject';

  /** Bắt buộc khi action = reject. */
  @IsOptional()
  @IsString()
  reject_reason?: string;
}

import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ImportSessionQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;

  @IsOptional()
  @IsIn(['pending_review', 'applied', 'cancelled', 'rolled_back'])
  status?: 'pending_review' | 'applied' | 'cancelled' | 'rolled_back';

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

/** Đặt quyết định Giữ/Bỏ cho một thay đổi trong session import. */
export class ChangeDecisionDto {
  @IsIn(['apply', 'skip'])
  decision: 'apply' | 'skip';
}

/**
 * Bộ lọc xuất danh sách phân công ra Excel — cùng bộ lọc với màn hình danh
 * sách khách (mục 2.1). File xuất ra nạp ngược lại được qua import: thiếu
 * phòng = bỏ phòng, nên bộ lọc càng hẹp thì nạp lại càng dễ mất phân công
 * ngoài bộ lọc (ghi rõ trong tài liệu API mục 3).
 */
export class ExportAssignmentsQueryDto {
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

  /** Tìm theo mã, tên hoặc mã SAP khách. */
  @IsOptional()
  @IsString()
  search?: string;
}

import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Bộ lọc chung cho nhóm API báo cáo KPI.
 *
 * Khoảng xem do `resolveWindow` của service phân giải: `fiscal_year` +
 * `quarter` (mặc định quý tài chính hiện tại) → khoảng = đúng quý; `from`/`to`
 * → khoảng tuỳ chọn, thiếu một đầu thì điền như luật cũ (chỉ có `to` → lùi 30
 * ngày, chỉ có `from` → tới hôm nay).
 *
 * Quyền xem không đổi — server vẫn ép phạm vi theo role (saleId ngoài phạm vi →
 * 403); bộ lọc chỉ thu hẹp trong dữ liệu đã được phép xem.
 *
 * Nhóm `criterionKey`/`status`/`minRatio`/`met` đọc ở HAI cấp khác nhau:
 * - overview (cấp SALE): đếm/lọc các sale theo kết quả một tiêu chí.
 * - by-sale (cấp KHÁCH): khoanh khách theo kết quả một tiêu chí.
 * Service của mỗi endpoint tự kiểm tra ngữ nghĩa cho đúng cấp của nó.
 */
export class KpiOverviewQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  saleId?: number;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  /**
   * Khoảng xem theo QUÝ TÀI CHÍNH — `fiscal_year` và `quarter` phải đi cùng
   * nhau (thiếu một cái → 400). Năm tài chính: Q1 = tháng 4-6, Q2 = 7-8-9,
   * Q3 = 10-11-12, Q4 = 1-2-3; năm tài chính 2026 = 01/04/2026–31/03/2027
   * (đúng tham số `year` của API chỉ tiêu).
   *
   * Có đủ hai tham số thì khoảng xem = đúng quý đó; không truyền gì thì mặc
   * định quý tài chính hiện tại. Chỉ quý mới so được chỉ tiêu và kết luận
   * đạt/không đạt; khoảng `from`/`to` (tuần, tháng...) chỉ báo doanh thu thực.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscal_year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  quarter?: number;

  /**
   * overview: lọc theo tên sale. by-sale: lọc theo mã, tên hoặc mã SAP
   * khách hàng.
   */
  @IsOptional()
  @IsString()
  search?: string;

  /**
   * Khoanh xuống một tiêu chí — bắt buộc kèm `status`, `minRatio` hoặc `met`
   * (đứng một mình không lọc được gì → 400).
   */
  @IsOptional()
  @IsString()
  criterionKey?: string;

  /**
   * Trạng thái của tiêu chí đang khoanh.
   * - by-sale (cấp khách): `ratio` = tiêu chí ratio, giá trị là % đạt.
   * - overview (cấp sale): tiêu chí ratio thường trả `ratio` nên `pass`/`fail`
   *   bị từ chối (400) — dùng `met` hoặc `minRatio` thay thế. NGOẠI LỆ là hai
   *   tiêu chí doanh số: ở cấp sale chúng CÓ kết luận đạt/không đạt (% đạt so
   *   chỉ tiêu quý) nên `pass`/`fail` được nhận.
   */
  @IsOptional()
  @IsIn(['pass', 'fail', 'ratio', 'no_data'])
  status?: 'pass' | 'fail' | 'ratio' | 'no_data';

  /**
   * % đạt tối thiểu. Tiêu chí doanh số đọc `% đạt so chỉ tiêu quý`, các tiêu
   * chí khác đọc `actualValue`; binary đọc 1/0.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minRatio?: number;

  /**
   * CHỈ overview (cấp sale): `true` = sale ĐẠT tiêu chí, `false` = có dữ liệu
   * nhưng không đạt. Bên `no_data` không khớp 2 chiều (không đủ dữ liệu kết
   * luận) — xem `criterionMet` trong kpi-report-filter.ts. Bắt buộc kèm
   * `criterionKey`; by-sale không dùng (400 nếu truyền).
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  met?: 'true' | 'false';
}

/**
 * by-sale = KpiOverviewQueryDto + bộ lọc bảng khách hàng + phân trang.
 *
 * Hai nhóm bộ lọc, đều chạy SAU bước chấm điểm trên toàn bộ khách của sale:
 * - Danh tính (tier/role/department/zaloStatus/sapCode/search): lọc trên
 *   dữ liệu đã nạp.
 * - Kết quả chấm (criterionKey/status/minRatio) và hoạt động
 *   (orders/revenue/tin nhắn/liên lạc/công nợ): cần dữ liệu đã chấm.
 *
 * Cả hai đều KHÔNG làm thay đổi đầu bảng `criteria` (cấp sale) — phần đó
 * luôn tính trên toàn bộ khách của sale, giống `search` trước đây.
 *
 * `criterionKey`/`status`/`minRatio` kế thừa từ lớp cha (nơi đã mô tả luật ở
 * cấp khách). `met` là của riêng overview — by-sale trả 400 nếu có truyền.
 */
export class KpiBySaleQueryDto extends KpiOverviewQueryDto {
  @IsOptional()
  @IsIn(['KEY', 'NON'])
  tier?: 'KEY' | 'NON';

  @IsOptional()
  @IsIn(['CHINH', 'PHU'])
  role?: 'CHINH' | 'PHU';

  /** Slug phòng ban: may-in | pc | linh-kien | laptop | ptkh1 | ptkh2. */
  @IsOptional()
  @IsString()
  department?: string;

  /** linked = có dữ liệu Zalo đo được trong khoảng xem; unlinked = chưa khớp. */
  @IsOptional()
  @IsIn(['linked', 'unlinked'])
  zaloStatus?: 'linked' | 'unlinked';

  /** Khớp CHÍNH XÁC mã đối tác SAP. */
  @IsOptional()
  @IsString()
  sapCode?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  hasOrders?: 'true' | 'false';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minOrders?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minRevenue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minOutbound?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minInbound?: number;

  /**
   * Số ngày chưa được liên lạc (không có tin SALE gửi đi) tính tới `to`.
   * Không có tin đi trong toàn bộ cửa sổ dữ liệu → khớp mọi ngưỡng.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  daysSinceContact?: number;

  /** Số dư công nợ tối thiểu — nạp công nợ bất kể có tiêu chí công nợ hay không. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minDebt?: number;

  @IsOptional()
  @IsIn(['true', 'false'])
  hasDebt?: 'true' | 'false';

  /** Trường hợp đặc biệt hoặc mã tiêu chí (ví dụ `support_khach`). */
  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

import { Injectable } from '@nestjs/common';
import {
  KpiComparison,
  KpiDefinition,
  KpiDenominator,
  ScoringMode,
} from './kpi-definition.entity';
import { FiscalQuarter } from './nkm-fiscal';

/**
 * Engine chấm điểm KPI — tính LÚC ĐỌC (thiết kế mục 5.3): sửa tiêu chí trên
 * web là hiện ngay ở lần tải báo cáo sau, không đợi cron.
 *
 * Nguồn dữ liệu: `customer_activity_daily` (job Python ghi, NestJS chỉ đọc —
 * đúng tiền lệ sale-response) và `customer_revenue_daily` (job đồng bộ API NKM
 * ghi). Mỗi metric một nhánh xử lý (adapter, mục 5.1.6): thêm nhóm phòng ban
 * sau này chỉ là thêm dòng `kpi_definitions`, không sửa engine.
 *
 * BẢNG QUY TẮC ĐÃ CHỐT VỚI NGƯỜI DÙNG (10/06/2026):
 * - support_khach  : TIÊU CHÍ 3 — "có đi hỗ trợ khách chưa". metric
 *   movement_report: tháng đạt khi có ≥1 tin nhắn báo cáo di chuyển khớp cụm
 *   system_config.movement_report_pattern (mặc định "di gap khach") + mã KH
 *   (bảng customer_movement_reports, job Python ghi, không phân biệt nguồn).
 * - lien_lac_phan_hoi: TIÊU CHÍ 4 — "có chủ động hỏi thăm khách chưa". metric
 *   monthly_contact: tháng đạt khi có ≥1 tin SALE nhắn đi tới khách
 *   (outbound > 0, không cần khách trả lời). (Trước đây là ratio 2 chiều.)
 * - goi_y_thuc_hien: binary. "Được gợi ý ngày D" = khách Key/Non không được
 *   liên lạc bằng tin đi trong ngưỡng bỏ bê của loại khách đó (bị bỏ bê);
 *   "đã xử lý" = ngày D sale nhắn lại ≥1 tin → tự nhận từ tin nhắn, không cần
 *   bảng gợi ý hay nút bấm (đúng chữ "Tổng hợp từ hoạt động" của thiết kế).
 *   Lưu ý: khoảng im lặng được đo bằng SỐ NGÀY ĐO ĐƯỢC (zalo_linked) không
 *   có tin đi — ngày sale offline không bị tính là "bỏ bê" oan.
 * - order_count / debt_balance: metric kiểu NGƯỠNG (giá trị tuyệt đối) — chấm
 *   binary so ngưỡng hoặc ratio so chỉ tiêu (chỉ mẫu số target_value; mẫu số
 *   đếm khách không có nghĩa với giá trị tuyệt đối).
 * - revenue_key / revenue_non: tiêu chí DOANH SỐ, nguồn chân lý là API NKM.
 *   Cấp khách = có phát sinh (≥1 phiếu); cấp sale = doanh thu + tỷ lệ Key/Non
 *   so chỉ tiêu QUÝ. Xem chi tiết ở khối REVENUE bên dưới.
 * - Cấp khách hàng: chỉ tiêu ratio trả % ngày đạt trong khoảng xem (FE ẩn nếu
 *   không cần — mục 5.1.6); binary trả pass/fail.
 * - Cấp Sale: ratio = "x/y khách đạt" (mẫu số mặc định là khách CÓ THỂ ĐO —
 *   zalo_linked, ngày sale offline không kéo tỉ lệ xuống, mục 5.1.5; cấu hình
 *   denominator = all_customers thì mẫu số là TOÀN BỘ khách trong danh sách);
 *   binary = "x/y khách đạt" trong khoảng xem.
 */

/**
 * Ngưỡng "bị bỏ bê" — số ngày ĐO ĐƯỢC không có tin đi thì khách rơi vào
 * danh sách gợi ý (mục 5.4). Tách theo loại khách vì nhịp chăm sóc khác nhau:
 * KEY là khách trọng điểm nên phải gọi sớm, NON bơm thường xuyên hơn nên
 * chờ lâu hơn cũng được.
 *
 * Ngày sale OFFLINE (không đo được dữ liệu Zalo) KHÔNG tính vào khoảng im
 * lặng — nếu tính thì sale đăng nhập muộn 3 ngày sẽ bị báo "bỏ bê" oan.
 */
export const SUGGESTION_KEY_GAP_DAYS = 3;
export const SUGGESTION_NON_GAP_DAYS = 7;

/**
 * Ngưỡng chấm tiêu chí "Gợi ý chăm sóc đã thực hiện": sale nhắn lại sau
 * ≥ SUGGESTION_ACK_GAP_DAYS ngày im lặng = đã xử lý gợi ý. Bằng ngưỡng bỏ bê
 * của KEY để gợi ý và tiêu chí nói chuyện với nhau (gợi ý bật sau 3 ngày
 * thì nhắn lại sau 3 ngày cũng phải được tính là xử lý).
 */
export const SUGGESTION_ACK_GAP_DAYS = 3;

/** Nhìn lại bao nhiêu ngày hoạt động để chấm gợi ý ở đầu khoảng xem. */
export const SUGGESTION_LOOKBACK_DAYS = SUGGESTION_NON_GAP_DAYS;

export const REASON_NO_REVENUE_DATA =
  'Chưa có dữ liệu doanh thu cho khách hàng này.';
export const REASON_NO_QUARTER_TARGET = 'Chưa có chỉ tiêu quý cho sale này.';
export const REASON_NO_SALE_MAPPING =
  'Chưa nạp được bảng tra mã NKM cho sale này — kiểm tra employee_code của nhân viên.';
export const REASON_NO_CUSTOMER_TIER =
  'Chưa xác định được loại khách (KEY/NON).';
export const REASON_SALE_OFFLINE =
  'Sale chưa đăng nhập Zalo. Dữ liệu sẽ tự cập nhật khi Sale đăng nhập lại.';
export const REASON_NO_ZALO_LINK =
  'Chưa có khách hàng nào khớp được tài khoản Zalo.';
export const REASON_NO_CUSTOMERS =
  'Sale chưa có khách hàng nào trong danh sách.';

/**
 * Metric kiểu NGƯỠNG — chấm trên giá trị tuyệt đối (số đơn, số dư công nợ)
 * thay vì trên tỉ lệ khách đạt. Nguồn:
 * - order_count  : cột `order_count` của customer_activity_daily (rollup ghi).
 * - debt_balance : tổng `remaining` của bảng `debts` (module công nợ), khớp
 *   theo `customer_raw_code` = mã đối tác SAP của khách; điểm theo thời điểm
 *   hiện tại (không theo ngày).
 */
export const THRESHOLD_METRICS = ['order_count', 'debt_balance'];

/**
 * Metric DOANH SỐ — nguồn chân lý là API NKM (thiết kế
 * THIET-KE-DOANH-SO-API-NKM.md). Hai cấp hai cách chấm khác nhau:
 *
 * - Cấp KHÁCH (`scoreCustomer`): ĐẠT khi có PHÁT SINH trong kỳ — ≥1 phiếu.
 *   Mỗi tiêu chí chỉ áp đúng loại khách: `doanh_so_key` chỉ chấm khách KEY,
 *   `doanh_so_non` chỉ chấm khách NON (khách KEY không bị quẹt "theo NON").
 *   Không gate `zalo_linked` — khách có mua hàng là có thật, dù sale chưa khớp
 *   liên hệ Zalo, nên adapter đứng TRƯỚC nhánh lọc ngày đo được, cùng chỗ với
 *   `movement_report`.
 * - Cấp SALE (`scoreSale`): doanh thu + tỷ lệ giữa Key và Non + % đạt so với
 *   chỉ tiêu QUÝ. `doanh_so_key` và `doanh_so_non` DÙNG CHUNG một target quý
 *   (target phân cho sale, không phân cho khách) nên cả hai trả cùng số:
 *   tỷ lệ Key/Non khác nhau, % đạt và kết luận đạt/không đạt giống nhau.
 *
 * Điểm then chốt đã đối chiếu từng đồng: doanh số = `LineTotal` (CHƯA VAT);
 * cộng `LineTotal` một sale cả quý 2 = `DatThucTeQ2` của API quý.
 */
export const REVENUE_METRICS = ['revenue_key', 'revenue_non'];

/** Metric của tiêu chí "Gợi ý thực hiện" (TC5) — dùng chung khoá với báo cáo. */
export const SUGGESTION_ACK_METRIC = 'suggestion_ack';

/**
 * Metric GỢI Ý ĐƠN HÀNG (tiêu chí 6) — "khách còn đơn CHƯA CHỐT trên Zalo tạo
 * trong 4 ngày gần nhất thì nhắc sale đốc chốt". Nguồn: `order_details` +
 * `orders` (DB chính, báo cáo nạp sẵn ở `loadOrderSuggestions`), khớp khách
 * qua `customer_zalo.zalo_contact_id = order_details.meta_customer_id` — đúng
 * đường liên kết mà job rollup dùng cho cột `order_count`.
 *
 * Hai con số nghiệp vụ yêu cầu: TỔNG SỐ GỢI Ý (số dòng đơn chưa chốt) và
 * TỔNG GIÁ TRỊ (`unit_price × quantity`, chưa VAT) — trả đủ ở
 * `orderSuggestion` cấp sale, và `openOrderCount`/`openOrderValue` cấp khách.
 *
 * Cửa sổ neo vào NGÀY HÔM NAY (giờ VN), KHÔNG theo khoảng xem của báo cáo:
 * khoảng quý có `to` là ngày cuối quý (tương lai) nên neo vào đó sẽ ra rỗng.
 *
 * Mặc định đạt khi có ≥1 gợi ý (target_value = 1, so `gte`) — nghĩa "có đơn
 * cần đốc chốt". Muốn nghĩa ngược lại (đạt = không còn đơn tồn) thì đổi
 * `comparison` sang `lte` + target 0 ở màn hình cấu hình tiêu chí, không cần
 * sửa code.
 */
export const ORDER_SUGGESTION_METRIC = 'open_order_suggestion';

/** Số ngày "gần nhất" của tiêu chí gợi ý đơn hàng. */
export const ORDER_SUGGESTION_WINDOW_DAYS = 4;

/**
 * Gợi ý hiện tại của MỘT khách (mục 5.4) — CHÍNH là phần tử của
 * `GET /customer-kpi-reports/suggestions`. Gắn thẳng vào ô tiêu chí của khách
 * trong `by-sale` để FE hiện câu gợi ý ngay trên dòng, và để hai nơi không bao
 * giờ lệch nhau (cùng một hàm tính).
 */
export interface CustomerSuggestion {
  assignmentId: number;
  customerId: number;
  customerCode: string;
  customerName: string;
  customerTier: string | null;
  /** Mã nhóm gợi ý: `chua_phan_hoi` | `key_chua_lien_lac` | `non_don_moi_chua_cham`. */
  reason: string;
  /** Câu gợi ý tiếng Việt để FE hiện thẳng. */
  reasonText: string;
  /** Ngày mốc của gợi ý (ngày khách nhắn / ngày đơn / ngày liên lạc cuối). */
  contextDate: string | null;
  /** Ngày sale liên lạc gần nhất — `null` = chưa từng. */
  lastContactDate: string | null;
  /** Doanh số kỳ hiện tại của khách (chưa VAT) — `null` = không có dữ liệu. */
  revenueCurrent?: number | null;
  /** Doanh số kỳ trước của khách — `null` = không có dữ liệu. */
  revenuePrevious?: number | null;
}

/** Số liệu gợi ý đơn hàng của MỘT khách (tiêu chí 6). */
export interface CustomerOrderSuggestion {
  /** Số dòng đơn chưa chốt trong cửa sổ. */
  count: number;
  /** Tổng giá trị các dòng đó (`unit_price × quantity`, chưa VAT). */
  totalValue: number;
  /** Ngày tạo đơn chưa chốt gần nhất (`YYYY-MM-DD`), `null` khi không có đơn. */
  latestOrderDate: string | null;
}

/** Số liệu gợi ý đơn hàng của MỘT nhóm khách (KEY hoặc NON). */
export interface OrderSuggestionTierSlice extends CustomerOrderSuggestion {
  /** Số đơn khác nhau (`orders.id`) của nhóm này. */
  orderCount: number;
  /** Số khách nhóm này đang có đơn chưa chốt / tổng khách của nhóm. */
  customersWithOrders: number;
  totalCustomers: number;
}

/** Số liệu gợi ý đơn hàng của MỘT sale (tiêu chí 6, cấp sale). */
export interface SaleOrderSuggestion extends CustomerOrderSuggestion {
  /** Số đơn khác nhau (`orders.id`) — một đơn có thể nhiều dòng sản phẩm. */
  orderCount: number;
  /** Số khách đang có đơn chưa chốt. */
  customersWithOrders: number;
  /** Tổng số khách trong danh sách của sale (mẫu số của "x/y khách"). */
  totalCustomers: number;
  /** Cửa sổ nhìn lại (ngày) — để FE ghi chú "trong N ngày gần nhất". */
  windowDays: number;
  /** Chia theo loại khách: số gợi ý + giá trị + "x/y khách" của KEY và NON. */
  byTier: { key: OrderSuggestionTierSlice; non: OrderSuggestionTierSlice };
}

const thresholdValueOf = (
  metric: string,
  windowed: ActivityDayRow[],
  debtBalance?: number | null,
): number | null => {
  if (metric === 'order_count') {
    return windowed.reduce(
      (acc, row) => acc + (Number(row.order_count) || 0),
      0,
    );
  }
  if (metric === 'debt_balance') {
    return debtBalance == null ? null : Number(debtBalance) || 0;
  }
  return null;
};

export interface ActivityDayRow {
  stat_date: string;
  inbound_count: number;
  outbound_count: number;
  order_count: number;
  revenue: number;
  zalo_linked: boolean;
  /** Số tin báo cáo di chuyển khớp cú pháp trong ngày (tiêu chí 3). */
  movement_count?: number;
}

/** Kết quả chấm MỘT tiêu chí cho MỘT khách hàng (màn hình chi tiết / by-sale). */
export interface CustomerCriterion {
  key: string;
  scoringMode: ScoringMode;
  status: 'pass' | 'fail' | 'ratio' | 'no_data';
  actualValue: number | null;
  targetValue: number | null;
  reason?: string;
  /** Bị quản lý ghi đè thủ công thành chưa đạt (khách báo cáo xấu...). */
  overridden?: boolean;
  overrideReason?: string | null;
  /**
   * Tiêu chí chỉ áp cho MỘT loại khách — `KEY` (doanh_so_key) hoặc `NON`
   * (doanh_so_non). `undefined` = áp cho cả hai loại.
   */
  tierScope?: 'KEY' | 'NON';
  /** Tiêu chí không áp cho loại khách của khách này — bỏ qua khi tổng hợp. */
  notApplicable?: boolean;
  /** Số phiếu của khách trong kỳ — > 0 là có phát sinh. */
  quantity?: number;
  /** Doanh số của khách trong kỳ (`LineTotal`, chưa VAT). */
  lineTotal?: number;
  /** Khách có phát sinh trong kỳ (≥1 phiếu) — chỉ tiêu chí doanh số trả. */
  hasRevenue?: boolean;
  /** Tiêu chí gợi ý đơn hàng: số dòng đơn chưa chốt trong cửa sổ. */
  openOrderCount?: number;
  /** Tiêu chí gợi ý đơn hàng: tổng giá trị các đơn chưa chốt (chưa VAT). */
  openOrderValue?: number;
  /** Tiêu chí gợi ý đơn hàng: ngày tạo đơn chưa chốt gần nhất. */
  openOrderDate?: string | null;
  /**
   * Tiêu chí "Gợi ý thực hiện": gợi ý ĐANG chờ của khách (`null` = hôm nay
   * không có việc gì với khách này). Cùng nguồn với
   * `GET /customer-kpi-reports/suggestions`.
   */
  suggestion?: CustomerSuggestion | null;
}

/** Kết luận theo LOẠI KHÁCH (thiết kế §5.3) — lớp tổng hợp trên các tiêu chí. */
export interface CustomerTierSummary {
  tier: 'KEY' | 'NON' | null;
  /** Số tiêu chí áp dụng cho loại khách này (cả Key và Non đều 4). */
  applicable: number;
  /** Số tiêu chí đã đạt. */
  passed: number;
  /**
   * KEY: đạt khi đạt TOÀN BỘ tiêu chí (nghiêm ngặt — "khách key bắt buộc phải
   * đạt 100%", hiểu là không được trượt một tiêu chí nào).
   * NON: `null` — KHÔNG kết luận đạt/trượt, chỉ đếm "đạt x/4 tiêu chí".
   */
  verdict: 'pass' | 'fail' | null;
}

/** Doanh thu của MỘT khách trong kỳ — báo cáo nạp sẵn từ customer_revenue_daily. */
export interface RevenueCustomerInput {
  customerId: number;
  /** `KEY` | `NON` — lấy từ `customer_assignments.customer_tier` (từng phân công). */
  tier: string | null;
  /** Số phiếu trong kỳ. */
  quantity: number;
  /** Doanh số trong kỳ (`LineTotal`, chưa VAT). */
  lineTotal: number;
}

/** Dữ liệu cần cho adapter doanh số cấp SALE. */
export interface RevenueSaleInput {
  /**
   * Quý tài chính mà khoảng xem phủ trọn — `null` khi khoảng xem là tuần/tháng
   * (hoặc không trọn quý). Chỉ khi có mới kết luận đạt/không đạt.
   */
  quarter: FiscalQuarter | null;
  /** Chỉ tiêu quý của sale (`sale_revenue_target`); cả hai tiêu chí dùng chung. */
  quarterTarget: number | null;
  /** Toàn bộ khách của sale kèm doanh thu trong kỳ. */
  customers: RevenueCustomerInput[];
  /**
   * `false` khi chưa nạp được bảng tra mã cho sale (chưa có `employee_code`
   * khớp NKM) — KHÔNG phải "sale không bán được gì", phải no_data kèm lý do để
   * admin nạp bảng tra mã.
   */
  mapped?: boolean;
}

/** Số liệu doanh số cấp sale — nguồn cho bảng phân phối (pivot) của lead. */
export interface SaleRevenueDetail {
  /** Tổng doanh số khách KEY trong kỳ. */
  dsoKey: number;
  /** Tổng doanh số khách NON trong kỳ. */
  dsoNon: number;
  /** `Dso Key / (Dso Key + Dso Non)` — 4 chữ số thập phân. */
  keyShareRatio: number | null;
  /** Tỷ lệ (DS Key) % — 2 chữ số thập phân. */
  keySharePct: number | null;
  /** Tỷ lệ (DS Non) % — 2 chữ số thập phân. */
  nonSharePct: number | null;
  /** Khách KEY có phát sinh / tổng khách KEY. */
  keyCustomers: { reached: number; total: number };
  /** Khách NON có phát sinh / tổng khách NON. */
  nonCustomers: { reached: number; total: number };
  /** Chỉ tiêu quý — cả hai tiêu chí dùng chung. */
  quarterTarget: number | null;
  /** `(Dso Key + Dso Non) / target quý` — 4 chữ số thập phân. */
  achievedRatio: number | null;
  /** % đạt — 2 chữ số thập phân. */
  achievedPct: number | null;
  /** `null` = khoảng xem không trọn quý, không kết luận được. */
  verdict: 'pass' | 'fail' | null;
  quarter: FiscalQuarter | null;
  isWholeQuarter: boolean;
}

/**
 * Tiến độ của một nhóm khách trong MỘT tiêu chí: "đạt bao nhiêu trên tổng".
 * Dùng cho khối `byTier` để FE hiện 3 dòng (tổng / KEY / NON) mà không phải
 * tự đếm lại từ danh sách khách.
 */
export interface TierProgress {
  /** Số khách đạt tiêu chí trong nhóm này. */
  passed: number;
  /** Tổng khách của nhóm này trong ĐÚNG mẫu số của tiêu chí. */
  total: number;
}

/**
 * Tiến độ tách theo loại khách (KEY / NON) của một tiêu chí cấp sale.
 * Khách chưa xác định loại (tier rỗng/khác KEY-NON) không nằm trong cả hai ô,
 * nên `key.total + non.total` có thể nhỏ hơn `totalCriteria` — dòng tổng vẫn
 * đọc theo `totalCriteria/passedCriteria` như hiện tại.
 */
export interface SaleTierBreakdown {
  key: TierProgress;
  non: TierProgress;
}

/** Kết quả chấm MỘT tiêu chí cho MỘT sale (overview / đầu trang by-sale). */
export interface SaleCriterion {
  key: string;
  name: string;
  scoringMode: ScoringMode;
  denominator: KpiDenominator | null;
  status: 'pass' | 'fail' | 'ratio' | 'no_data';
  actualValue: number | null;
  numerator: number | null;
  denominatorValue: number | null;
  targetValue: number | null;
  totalCriteria: number | null;
  passedCriteria: number | null;
  reason?: string;
  /** Cả tiêu chí của sale bị quản lý ghi đè thành chưa đạt. */
  overridden?: boolean;
  overrideReason?: string | null;
  /** Số liệu doanh số đầy đủ (chỉ tiêu chí doanh số cấp sale). */
  revenue?: SaleRevenueDetail;
  /** Số liệu gợi ý đơn hàng đầy đủ (chỉ tiêu chí gợi ý đơn hàng cấp sale). */
  orderSuggestion?: SaleOrderSuggestion;
  /**
   * "Đạt bao nhiêu trên tổng" tách theo loại khách — có ở mọi tiêu chí đếm
   * khách (binary) và tiêu chí doanh số. Vắng ở tiêu chí không có khái niệm
   * "khách đạt" (ratio trên giá trị tuyệt đối).
   */
  byTier?: SaleTierBreakdown;
  /**
   * Tiêu chí "Gợi ý thực hiện": số khách ĐANG có gợi ý chờ xử lý — KHÁC
   * `passedCriteria` (số khách đã xử lý xong). Chỉ có khi khoảng xem chạm tới
   * hôm nay (gợi ý luôn tính theo ngày hiện tại).
   */
  customersWithSuggestion?: number;
}

const pct = (num: number, den: number): number =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : 0;

/** Làm tròn `digits` chữ số thập phân — dùng cho tỉ lệ doanh số. */
export const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Chuẩn hoá loại khách: chỉ `KEY` / `NON` được tính, còn lại coi như chưa rõ. */
export const normalizedTier = (
  tier: string | null | undefined,
): 'KEY' | 'NON' | null => {
  const upper = (tier ?? '').toUpperCase();
  return upper === 'KEY' ? 'KEY' : upper === 'NON' ? 'NON' : null;
};

/**
 * "Đạt bao nhiêu trên tổng" tách theo KEY/NON trên MỘT tập khách — dùng chung
 * cho mọi tiêu chí cấp sale (kể cả doanh số) nên ba dòng tổng / KEY / NON luôn
 * tính trên cùng một mẫu số với `totalCriteria/passedCriteria`.
 *
 * Khách chưa xác định loại không vào ô nào (giữ đúng hành vi của bảng phân phối
 * doanh số — `rollupRevenue` cũng bỏ qua nhóm không rõ KEY/NON).
 */
export const tierBreakdown = <T>(
  rows: T[],
  tierOf: (row: T) => string | null | undefined,
  passedOf: (row: T) => boolean,
): SaleTierBreakdown => {
  const result: SaleTierBreakdown = {
    key: { passed: 0, total: 0 },
    non: { passed: 0, total: 0 },
  };
  for (const row of rows) {
    const tier = normalizedTier(tierOf(row));
    if (!tier) continue;
    const bucket = tier === 'KEY' ? result.key : result.non;
    bucket.total += 1;
    if (passedOf(row)) bucket.passed += 1;
  }
  return result;
};

/**
 * Tiêu chí có áp cho loại khách này không. Tiêu chí doanh số chỉ áp đúng loại
 * (`tierScope`); các tiêu chí còn lại áp cho cả Key và Non.
 */
export const criterionAppliesToTier = (
  criterion: CustomerCriterion,
  tier: string,
): boolean =>
  criterion.notApplicable !== true &&
  (!criterion.tierScope || criterion.tierScope === tier);

/** Số liệu phân phối (pivot) gộp được từ một tập khách — sale, nhóm hay công ty. */
export interface RevenueRollup {
  /** Tổng doanh số khách KEY. */
  dsoKey: number;
  /** Tổng doanh số khách NON. */
  dsoNon: number;
  /** `Dso Key / (Dso Key + Dso Non)` — 4 chữ số thập phân. */
  keyShareRatio: number | null;
  /** Tỷ lệ (DS Key) % — 2 chữ số thập phân. */
  keySharePct: number | null;
  /** Tỷ lệ (DS Non) % — 2 chữ số thập phân. */
  nonSharePct: number | null;
  /** Khách KEY có phát sinh / tổng khách KEY. */
  keyCustomers: { reached: number; total: number };
  /** Khách NON có phát sinh / tổng khách NON. */
  nonCustomers: { reached: number; total: number };
}

/**
 * Gộp doanh thu một tập khách thành một dòng bảng phân phối — dùng cho đầu bảng
 * cấp sale, hàng tổng cấp nhóm và hàng tổng công ty nên cả ba cấp luôn khớp
 * nhau. Cấp nhóm/công ty CỘNG DỒN các sale nên doanh thu không bị trùng (lấy
 * theo `slpCode` từng sale); riêng đếm khách theo quan hệ PHÂN CÔNG nên khách
 * thuộc nhiều phòng bị đếm ở cả hai phòng — FE cần ghi chú cho khỏi hiểu nhầm.
 */
export const rollupRevenue = (
  customers: RevenueCustomerInput[],
): RevenueRollup => {
  const tierOf = (row: RevenueCustomerInput) => (row.tier ?? '').toUpperCase();
  const keyRows = customers.filter((row) => tierOf(row) === 'KEY');
  const nonRows = customers.filter((row) => tierOf(row) === 'NON');
  const sumOf = (rows: RevenueCustomerInput[]) =>
    rows.reduce((acc, row) => acc + row.lineTotal, 0);
  const dsoKey = sumOf(keyRows);
  const dsoNon = sumOf(nonRows);
  const total = dsoKey + dsoNon;
  return {
    dsoKey,
    dsoNon,
    keyShareRatio: total > 0 ? roundTo(dsoKey / total, 4) : null,
    keySharePct: total > 0 ? roundTo((dsoKey / total) * 100, 2) : null,
    nonSharePct: total > 0 ? roundTo((dsoNon / total) * 100, 2) : null,
    keyCustomers: {
      reached: keyRows.filter((row) => row.quantity > 0).length,
      total: keyRows.length,
    },
    nonCustomers: {
      reached: nonRows.filter((row) => row.quantity > 0).length,
      total: nonRows.length,
    },
  };
};

const sumOutbound = (rows: ActivityDayRow[]): number =>
  rows.reduce((acc, row) => acc + (Number(row.outbound_count) || 0), 0);

const isInbound = (row: ActivityDayRow): boolean =>
  (Number(row.inbound_count) || 0) > 0;
const isOutbound = (row: ActivityDayRow): boolean =>
  (Number(row.outbound_count) || 0) > 0;
const isTwoWay = (row: ActivityDayRow): boolean =>
  isInbound(row) && isOutbound(row);

@Injectable()
export class CustomerKpiScoringService {
  /**
   * Chấm MỘT tiêu chí cho MỘT khách hàng trên khoảng ngày.
   *
   * `days`: hoạt động theo ngày, PHẢI bao gồm cả SUGGESTION_LOOKBACK_DAYS
   * ngày trước `fromDate` để chấm gợi ý ở đầu khoảng (nhìn lại khoảng trống
   * liên lạc). Chỉ những ngày >= fromDate mới được tính vào kết quả.
   * `debtBalance`: chỉ cần cho metric `debt_balance` — số dư công nợ hiện tại
   * của khách (báo cáo nạp sẵn từ bảng `debts`).
   * `revenue`: chỉ cần cho tiêu chí doanh số — số phiếu + doanh số của khách
   * trong kỳ (báo cáo nạp sẵn từ `customer_revenue_daily`).
   * `openOrders`: chỉ cần cho tiêu chí gợi ý đơn hàng — số dòng đơn CHƯA CHỐT
   * trong N ngày gần nhất + tổng giá trị (báo cáo nạp sẵn từ `order_details`).
   */
  scoreCustomer(
    definition: KpiDefinition,
    days: ActivityDayRow[],
    targetValue: number | null,
    fromDate: string,
    debtBalance?: number | null,
    revenue?: { tier: string | null; quantity: number; lineTotal: number },
    openOrders?: CustomerOrderSuggestion | null,
  ): CustomerCriterion {
    const base: CustomerCriterion = {
      key: definition.key,
      scoringMode: definition.scoring_mode,
      status: 'no_data',
      actualValue: null,
      targetValue,
    };

    if (REVENUE_METRICS.includes(definition.metric)) {
      return this.scoreCustomerRevenue(definition, base, revenue);
    }

    // Tiêu chí 6 đọc bảng đơn ở DB chính (orders/order_details) — không phụ
    // thuộc việc khớp liên hệ Zalo nên chấm TRƯỚC nhánh lọc ngày đo được, cùng
    // chỗ đứng với movement_report và tiêu chí doanh số.
    if (definition.metric === ORDER_SUGGESTION_METRIC) {
      return this.scoreCustomerOrderSuggestion(definition, base, openOrders);
    }

    // Tiêu chí 3 KHÔNG gate zalo_linked: báo cáo di chuyển tồn tại độc lập với
    // khớp liên hệ Zalo nên phải chấm TRƯỚC nhánh lọc ngày đo được (sale chưa
    // khớp liên hệ vẫn có thể đã gửi báo cáo trong nhóm).
    if (definition.metric === 'movement_report') {
      const reported = days.filter(
        (row) => (row.movement_count ?? 0) > 0 && row.stat_date >= fromDate,
      );
      return {
        ...base,
        status: reported.length > 0 ? 'pass' : 'fail',
        actualValue: reported.length > 0 ? 1 : 0,
      };
    }

    const linked = days.filter((row) => Boolean(row.zalo_linked));
    const windowed = linked.filter((row) => row.stat_date >= fromDate);
    if (windowed.length === 0) {
      return { ...base, reason: REASON_NO_ZALO_LINK };
    }

    if (THRESHOLD_METRICS.includes(definition.metric)) {
      return this.scoreThresholdCustomer(
        definition,
        thresholdValueOf(definition.metric, windowed, debtBalance),
        targetValue,
      );
    }

    if (definition.metric === 'contacted_customers') {
      const passed = windowed.filter(isOutbound).length;
      return {
        ...base,
        status: 'ratio',
        actualValue: pct(passed, windowed.length),
      };
    }

    if (definition.metric === 'responded_customers') {
      const passed = windowed.filter(isTwoWay).length;
      return {
        ...base,
        status: 'ratio',
        actualValue: pct(passed, windowed.length),
      };
    }

    // Tiêu chí 4 — tháng đạt khi có ≥1 tin SALE nhắn đi tới khách.
    if (definition.metric === 'monthly_contact') {
      const touched = windowed.filter(isOutbound).length;
      return {
        ...base,
        status: touched > 0 ? 'pass' : 'fail',
        actualValue: touched > 0 ? 1 : 0,
      };
    }

    if (definition.metric === SUGGESTION_ACK_METRIC) {
      const passed = this.countSuggestionHandled(days, fromDate);
      return {
        ...base,
        status: passed > 0 ? 'pass' : 'fail',
        actualValue: passed > 0 ? 1 : 0,
      };
    }

    // Metric chưa có adapter — coi như chưa có nguồn dữ liệu
    return {
      ...base,
      reason: `Chưa hỗ trợ metric "${definition.metric}".`,
    };
  }

  /**
   * Cấp KHÁCH của tiêu chí doanh số: khách đạt khi có PHÁT SINH trong kỳ ≥1
   * phiếu (khách KEY bắt buộc có phát sinh — "phát sinh số" như file lead gửi).
   *
   * Chỉ chấm đúng loại khách: `doanh_so_key` chỉ chấm khách KEY, `doanh_so_non`
   * chỉ chấm khách NON; tiêu chí của loại kia trả `no_data` kèm ghi chú "khách X
   * không chấm tiêu chí này" để FE hiểu là cột đó cố tịt, không phải lỗi. Lớp
   * tổng hợp theo loại khách (`summarizeCustomerByTier`) bỏ qua các ô này.
   */
  private scoreCustomerRevenue(
    definition: KpiDefinition,
    base: CustomerCriterion,
    revenue?: { tier: string | null; quantity: number; lineTotal: number },
  ): CustomerCriterion {
    const tierScope: 'KEY' | 'NON' =
      definition.metric === 'revenue_key' ? 'KEY' : 'NON';
    if (!revenue) {
      // Chưa nạp được dữ liệu đồng bộ (bảng tra mã trống / job chưa chạy) —
      // KHÔNG kết luận trượt, tránh "sale không bán được gì" oan.
      return { ...base, tierScope, reason: REASON_NO_REVENUE_DATA };
    }
    const tier = (revenue.tier ?? '').toUpperCase();
    if (tier && tier !== tierScope) {
      return {
        ...base,
        tierScope,
        notApplicable: true,
        reason: `Khách ${tier} không chấm tiêu chí này.`,
      };
    }
    if (!tier) {
      return {
        ...base,
        tierScope,
        notApplicable: true,
        reason: REASON_NO_CUSTOMER_TIER,
      };
    }
    const occurred = revenue.quantity > 0;
    return {
      ...base,
      tierScope,
      status: occurred ? 'pass' : 'fail',
      actualValue: occurred ? 1 : 0,
      quantity: revenue.quantity,
      lineTotal: revenue.lineTotal,
      hasRevenue: occurred,
    };
  }

  /**
   * Cấp KHÁCH của tiêu chí gợi ý đơn hàng: khách "đạt" khi có ≥1 dòng đơn CHƯA
   * CHỐT tạo trong cửa sổ N ngày gần nhất (mặc định 4) — tức CÓ việc để sale
   * đốc chốt, kèm tổng giá trị. Ngưỡng lấy từ cấu hình (`target_value`, mặc
   * định 1) nên đổi luật chỉ cần sửa ở màn hình cấu hình tiêu chí.
   *
   * Khách không khớp được liên hệ Zalo nào thì không có `openOrders` → 0 gợi ý
   * (fail), KHÔNG phải no_data: "khách không có đơn chưa chốt" là sự thật kiểm
   * chứng được, khác với "thiếu nguồn dữ liệu".
   */
  private scoreCustomerOrderSuggestion(
    definition: KpiDefinition,
    base: CustomerCriterion,
    openOrders?: CustomerOrderSuggestion | null,
  ): CustomerCriterion {
    const count = openOrders?.count ?? 0;
    const target = base.targetValue ?? definition.target_value ?? 1;
    return {
      ...base,
      status: this.compareValue(count, Number(target), definition.comparison)
        ? 'pass'
        : 'fail',
      actualValue: count,
      openOrderCount: count,
      openOrderValue: openOrders?.totalValue ?? 0,
      openOrderDate: openOrders?.latestOrderDate ?? null,
    };
  }

  /**
   * Cấp SALE của tiêu chí gợi ý đơn hàng — hai con số lead cần nhìn: TỔNG SỐ
   * GỢI Ý (số dòng đơn chưa chốt) và TỔNG GIÁ TRỊ đang nằm ở đó. `numerator`
   * giữ tổng số gợi ý; `passedCriteria/totalCriteria` là "x/y khách đang có
   * đơn chưa chốt" cho đồng bộ với các tiêu chí binary khác.
   *
   * `detail` là `undefined` khi báo cáo không nạp dữ liệu đơn (không có tiêu
   * chí này đang bật) — khi đó trả no_data kèm lý do thay vì kết luận trượt oan.
   */
  private scoreSaleOrderSuggestion(
    definition: KpiDefinition,
    base: SaleCriterion,
    saleTargetValue: number | null,
    detail?: SaleOrderSuggestion | null,
  ): SaleCriterion {
    if (!detail) {
      return { ...base, reason: REASON_NO_CUSTOMERS };
    }
    const target = saleTargetValue ?? definition.target_value ?? 1;
    return {
      ...base,
      status: this.compareValue(
        detail.count,
        Number(target),
        definition.comparison,
      )
        ? 'pass'
        : 'fail',
      actualValue: detail.count,
      numerator: detail.count,
      totalCriteria: detail.totalCustomers,
      passedCriteria: detail.customersWithOrders,
      orderSuggestion: detail,
      // "x/y khách" tách KEY/NON — FE hiện kèm số gợi ý + giá trị của từng loại
      byTier: this.orderSuggestionTierBreakdown(detail),
    };
  }

  /**
   * "Đạt x/y" tách KEY/NON của tiêu chí gợi ý đơn hàng. Dữ liệu chi tiết có thể
   * đến từ nơi gọi tự dựng (thiếu `byTier`) — lùi về 0/0 thay vì ném lỗi làm
   * hỏng cả báo cáo; có `byTier` thì lấy đúng "số khách có đơn / tổng khách".
   */
  private orderSuggestionTierBreakdown(
    detail: SaleOrderSuggestion,
  ): SaleTierBreakdown {
    const progress = (tier: 'key' | 'non'): TierProgress => {
      const slice = detail.byTier?.[tier];
      return slice
        ? {
            passed: slice.customersWithOrders,
            total: slice.totalCustomers,
          }
        : { passed: 0, total: 0 };
    };
    return { key: progress('key'), non: progress('non') };
  }

  /**
   * Cấp SALE của tiêu chí doanh số — đầu ra khớp bảng phân phối (pivot) lead
   * gửi: Dso Key, Dso Non, Tỷ lệ (DS Key), % đạt so với target quý.
   *
   * `doanh_so_key` và `doanh_so_non` dùng CHUNG một target quý nên hai dòng có
   * cùng % đạt và cùng kết luận; khác nhau ở tử số (Dso Key hay Dso Non) và tỷ
   * lệ tương ứng. Mẫu số của cả hai là tổng Dso (Dso Key + Dso Non) — đúng cách
   * pivot chia tỷ lệ Key/Non.
   *
   * Khoảng xem = tuần/tháng (không trọn quý) thì KHÔNG so target: chỉ báo doanh
   * thu thực của đúng khoảng đó, `status: 'ratio'`, không kết luận đạt/không
   * đạt — "target sao mà chia được" (chủ sở hữu chốt).
   */
  private scoreSaleRevenue(
    definition: KpiDefinition,
    base: SaleCriterion,
    revenue?: RevenueSaleInput,
  ): SaleCriterion {
    const tierScope: 'KEY' | 'NON' =
      definition.metric === 'revenue_key' ? 'KEY' : 'NON';
    if (!revenue || revenue.mapped === false) {
      // Chưa nạp được bảng tra mã / job chưa chạy — KHÔNG kết luận trượt, tránh
      // "sale không bán được gì" oan.
      return {
        ...base,
        reason:
          revenue?.mapped === false
            ? REASON_NO_SALE_MAPPING
            : REASON_NO_REVENUE_DATA,
      };
    }
    if (revenue.customers.length === 0) {
      return { ...base, reason: REASON_NO_CUSTOMERS };
    }
    const rollup = rollupRevenue(revenue.customers);
    const numerator = tierScope === 'KEY' ? rollup.dsoKey : rollup.dsoNon;
    const total = rollup.dsoKey + rollup.dsoNon;
    const achievedRatio =
      revenue.quarter != null &&
      revenue.quarterTarget != null &&
      revenue.quarterTarget > 0
        ? roundTo(total / revenue.quarterTarget, 4)
        : null;

    const detail: SaleRevenueDetail = {
      ...rollup,
      quarterTarget: revenue.quarterTarget,
      achievedRatio,
      achievedPct:
        achievedRatio != null ? roundTo(achievedRatio * 100, 2) : null,
      verdict:
        achievedRatio != null ? (achievedRatio >= 1 ? 'pass' : 'fail') : null,
      quarter: revenue.quarter,
      isWholeQuarter: revenue.quarter != null,
    };

    // Trọn quý mà chưa có chỉ tiêu → no_data: không thể kết luận đạt/không đạt,
    // nhưng vẫn giữ số liệu doanh thu trong `revenue` để FE hiện đúng thực tế.
    if (revenue.quarter != null && revenue.quarterTarget == null) {
      return {
        ...base,
        status: 'no_data',
        reason: REASON_NO_QUARTER_TARGET,
        revenue: detail,
        byTier: this.revenueTierBreakdown(detail),
      };
    }

    const actualValue =
      tierScope === 'KEY' ? detail.keySharePct : detail.nonSharePct;
    return {
      ...base,
      // Không trọn quý → không kết luận, chỉ báo doanh thu thực (kiểu ratio)
      status: detail.verdict ?? 'ratio',
      actualValue,
      numerator,
      denominatorValue: total,
      targetValue: revenue.quarterTarget,
      revenue: detail,
      byTier: this.revenueTierBreakdown(detail),
    };
  }

  /**
   * "Khách có phát sinh" tách KEY/NON của tiêu chí doanh số — dùng lại đúng số
   * của bảng phân phối (`keyCustomers`/`nonCustomers`) nên hai chỗ không lệch.
   */
  private revenueTierBreakdown(detail: SaleRevenueDetail): SaleTierBreakdown {
    return {
      key: {
        passed: detail.keyCustomers.reached,
        total: detail.keyCustomers.total,
      },
      non: {
        passed: detail.nonCustomers.reached,
        total: detail.nonCustomers.total,
      },
    };
  }

  /**
   * Kết luận theo loại khách (§5.3): KEY thì nghiêm ngặt — đạt khi đạt TOÀN BỘ
   * tiêu chí áp dụng (doanh số đúng loại + TC3 + TC4 + Gợi ý, mặc định 4); NON
   * thì không kết luận đạt/trượt, chỉ đếm "đạt x/4 tiêu chí".
   *
   * Tiêu chí không áp cho loại khách (`notApplicable` — ví dụ khách KEY bị quẹt
   * `doanh_so_non`) bị bỏ qua khỏi cả tử và mẫu.
   */
  summarizeCustomerByTier(
    criteria: CustomerCriterion[],
    tier: string | null,
  ): CustomerTierSummary {
    const upper = (tier ?? '').toUpperCase();
    const normalized: 'KEY' | 'NON' | null =
      upper === 'KEY' ? 'KEY' : upper === 'NON' ? 'NON' : null;
    const applicable = criteria.filter((criterion) =>
      criterionAppliesToTier(criterion, upper),
    );
    const passed = applicable.filter(
      (criterion) => criterion.status === 'pass',
    ).length;
    return {
      tier: normalized,
      applicable: applicable.length,
      passed,
      verdict:
        normalized === 'KEY'
          ? applicable.length > 0 && passed === applicable.length
            ? 'pass'
            : 'fail'
          : null,
    };
  }

  /**
   * Số ngày trong khoảng xem mà sale "đã xử lý gợi ý": khách bị bỏ bê
   * ≥ SUGGESTION_GAP_DAYS ngày (không có tin đi) rồi sale chủ động nhắn lại.
   * Cần lịch sử hoạt động trước fromDate để xác định "bị bỏ bê".
   */
  countSuggestionHandled(days: ActivityDayRow[], fromDate: string): number {
    const sorted = [...days].sort((a, b) =>
      a.stat_date.localeCompare(b.stat_date),
    );
    let handled = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      const day = sorted[i];
      if (day.stat_date < fromDate) continue;
      if (!day.zalo_linked || !isOutbound(day)) continue;
      // Khoảng im lặng tính bằng SỐ NGÀY ĐO ĐƯỢC ngay trước ngày này — ngày
      // sale offline (không đo được dữ liệu Zalo) không phải là "bỏ bê".
      const history: ActivityDayRow[] = [];
      for (
        let j = i - 1;
        j >= 0 && history.length < SUGGESTION_ACK_GAP_DAYS;
        j -= 1
      ) {
        if (sorted[j].zalo_linked) history.push(sorted[j]);
      }
      const stale =
        history.length >= SUGGESTION_ACK_GAP_DAYS &&
        history.every((row) => !isOutbound(row));
      if (stale) handled += 1;
    }
    return handled;
  }

  /**
   * Chấm metric kiểu NGƯỢNG cho MỘT khách: so giá trị với ngưỡng (binary) hoặc
   * tính % so chỉ tiêu (ratio). Mẫu số chỉ hợp lệ với `target_value` — các mẫu
   * số đếm khách (`all_customers`, `reachable_customers`) không có nghĩa với
   * một giá trị tuyệt đối, cấu hình sai sẽ trả no_data kèm lý do rõ ràng.
   */
  private scoreThresholdCustomer(
    definition: KpiDefinition,
    value: number | null,
    targetValue: number | null,
  ): CustomerCriterion {
    const base: CustomerCriterion = {
      key: definition.key,
      scoringMode: definition.scoring_mode,
      status: 'no_data',
      actualValue: null,
      targetValue,
    };
    if (value == null) {
      return { ...base, reason: 'Chưa có dữ liệu công nợ cho khách hàng này.' };
    }
    if (definition.scoring_mode === ScoringMode.BINARY) {
      if (targetValue == null) {
        return { ...base, reason: 'Chưa cấu hình ngưỡng cho tiêu chí.' };
      }
      return {
        ...base,
        status: this.compareValue(value, targetValue, definition.comparison)
          ? 'pass'
          : 'fail',
        actualValue: value,
      };
    }
    if (definition.denominator !== KpiDenominator.TARGET_VALUE) {
      return {
        ...base,
        reason: `Mẫu số "${definition.denominator}" không áp dụng cho metric "${definition.metric}" — dùng target_value.`,
      };
    }
    if (targetValue == null) {
      return { ...base, reason: 'Chưa có chỉ tiêu cho tiêu chí này.' };
    }
    return { ...base, status: 'ratio', actualValue: pct(value, targetValue) };
  }

  /** `gte` (mặc định): đạt khi value >= target. `lte`: đạt khi value <= target. */
  private compareValue(
    value: number,
    target: number,
    comparison: KpiComparison | null,
  ): boolean {
    if (comparison === KpiComparison.LTE) return value <= target;
    return value >= target;
  }

  /**
   * Chấm MỘT tiêu chí cho MỘT sale trên khoảng ngày, từ dữ liệu thô từng
   * khách. `customers`: mỗi phần tử là hoạt động của một khách + chỉ tiêu
   * riêng (nếu có) — đã lọc khách thuộc sale.
   * `revenue`: chỉ cần cho tiêu chí doanh số — doanh thu từng khách + chỉ tiêu
   * quý của sale.
   * `orderSuggestions`: chỉ cần cho tiêu chí gợi ý đơn hàng — tổng hợp đơn
   * CHƯA CHỐT trong N ngày gần nhất của sale (báo cáo nạp sẵn).
   */
  scoreSale(
    definition: KpiDefinition,
    customers: {
      days: ActivityDayRow[];
      targetValue?: number | null;
      debtBalance?: number | null;
      /** `KEY` | `NON` (từ dòng phân công) — để tách "đạt x/y" theo loại khách. */
      tier?: string | null;
    }[],
    saleTargetValue: number | null,
    saleOnline: boolean,
    fromDate: string,
    revenue?: RevenueSaleInput,
    orderSuggestions?: SaleOrderSuggestion | null,
  ): SaleCriterion {
    const base: SaleCriterion = {
      key: definition.key,
      name: definition.name,
      scoringMode: definition.scoring_mode,
      denominator: definition.denominator ?? null,
      status: 'no_data',
      actualValue: null,
      numerator: null,
      denominatorValue: null,
      targetValue: saleTargetValue,
      totalCriteria: null,
      passedCriteria: null,
    };

    if (REVENUE_METRICS.includes(definition.metric)) {
      return this.scoreSaleRevenue(definition, base, revenue);
    }

    if (definition.metric === ORDER_SUGGESTION_METRIC) {
      return this.scoreSaleOrderSuggestion(
        definition,
        base,
        saleTargetValue,
        orderSuggestions,
      );
    }
    // Chỉ những ngày >= fromDate được tính vào kết quả — ngày lookback (trước
    // khoảng xem) chỉ phục vụ chấm gợi ý, KHÔNG được đếm vào support/phản hồi
    const windowedCustomers = customers.map((c) => ({
      ...c,
      days: c.days.filter((row) => row.stat_date >= fromDate),
    }));

    // Mẫu số: mặc định chỉ khách CÓ THỂ ĐO (zalo_linked — ngày sale offline
    // không kéo tỉ lệ xuống); cấu hình all_customers thì lấy TOÀN BỘ khách
    // trong danh sách (thiết kế mục 5.1.5).
    const countAllCustomers =
      definition.denominator === KpiDenominator.ALL_CUSTOMERS;
    const reachable = (
      list: typeof windowedCustomers,
    ): typeof windowedCustomers =>
      countAllCustomers
        ? list
        : list.filter((c) => c.days.some((row) => row.zalo_linked));
    const emptyPoolReason = countAllCustomers
      ? REASON_NO_CUSTOMERS
      : saleOnline
        ? REASON_NO_ZALO_LINK
        : REASON_SALE_OFFLINE;

    if (THRESHOLD_METRICS.includes(definition.metric)) {
      const pool = reachable(windowedCustomers);
      if (pool.length === 0) {
        return { ...base, reason: emptyPoolReason };
      }
      const perCustomer = pool.map((c) => ({
        row: c,
        value: thresholdValueOf(definition.metric, c.days, c.debtBalance),
        target: c.targetValue ?? saleTargetValue,
      }));
      const passesThreshold = (pc: (typeof perCustomer)[number]): boolean =>
        pc.value != null &&
        pc.target != null &&
        this.compareValue(pc.value, pc.target, definition.comparison);

      if (definition.scoring_mode === ScoringMode.BINARY) {
        // Không ai có ngưỡng/chi tiêu → chưa cấu hình xong, không kết luật fail
        if (perCustomer.every((pc) => pc.target == null)) {
          return { ...base, reason: 'Chưa cấu hình ngưỡng cho tiêu chí.' };
        }
        const passed = perCustomer.filter(passesThreshold);
        return {
          ...base,
          status: passed.length > 0 ? 'pass' : 'fail',
          actualValue: passed.length > 0 ? 1 : 0,
          totalCriteria: pool.length,
          passedCriteria: passed.length,
          numerator: passed.length,
          denominatorValue: pool.length,
          byTier: tierBreakdown(
            perCustomer,
            (pc) => pc.row.tier,
            passesThreshold,
          ),
        };
      }
      if (definition.denominator !== KpiDenominator.TARGET_VALUE) {
        return {
          ...base,
          reason: `Mẫu số "${definition.denominator}" không áp dụng cho metric "${definition.metric}" — dùng target_value.`,
        };
      }
      if (saleTargetValue == null) {
        return { ...base, reason: 'Chưa có chỉ tiêu cho tiêu chí này.' };
      }
      const total = perCustomer.reduce((acc, pc) => acc + (pc.value ?? 0), 0);
      return {
        ...base,
        status: 'ratio',
        actualValue: pct(total, saleTargetValue),
        numerator: total,
        denominatorValue: saleTargetValue,
      };
    }

    if (definition.metric === 'contacted_customers') {
      const pool = reachable(windowedCustomers);
      if (pool.length === 0) {
        return {
          ...base,
          reason: emptyPoolReason,
        };
      }
      const touched = (c: (typeof pool)[number]) =>
        c.days.some((row) => row.zalo_linked && isOutbound(row));
      const passed = pool.filter(touched);
      return {
        ...base,
        status: 'ratio',
        actualValue: pct(passed.length, pool.length),
        numerator: passed.length,
        denominatorValue: pool.length,
        totalCriteria: pool.length,
        passedCriteria: passed.length,
        byTier: tierBreakdown(pool, (c) => c.tier, touched),
      };
    }

    if (definition.metric === 'responded_customers') {
      const pool = reachable(windowedCustomers);
      if (pool.length === 0) {
        return {
          ...base,
          reason: emptyPoolReason,
        };
      }
      const replied = (c: (typeof pool)[number]) =>
        c.days.some((row) => row.zalo_linked && isTwoWay(row));
      const passed = pool.filter(replied);
      return {
        ...base,
        status: 'ratio',
        actualValue: pct(passed.length, pool.length),
        numerator: passed.length,
        denominatorValue: pool.length,
        totalCriteria: pool.length,
        passedCriteria: passed.length,
        byTier: tierBreakdown(pool, (c) => c.tier, replied),
      };
    }

    // Tiêu chí 3 — báo cáo không cần khớp liên hệ Zalo nên mẫu số là TOÀN BỘ
    // khách của sale (khác reachable của các tiêu chí Zalo)
    if (definition.metric === 'movement_report') {
      const pool = windowedCustomers;
      if (pool.length === 0) {
        return { ...base, reason: REASON_NO_CUSTOMERS };
      }
      const reported = (c: (typeof pool)[number]) =>
        c.days.some(
          (row) => (row.movement_count ?? 0) > 0 && row.stat_date >= fromDate,
        );
      const passed = pool.filter(reported);
      return {
        ...base,
        status: passed.length > 0 ? 'pass' : 'fail',
        actualValue: passed.length > 0 ? 1 : 0,
        numerator: passed.length,
        denominatorValue: pool.length,
        totalCriteria: pool.length,
        passedCriteria: passed.length,
        byTier: tierBreakdown(pool, (c) => c.tier, reported),
      };
    }

    // Tiêu chí 4 — cùng mẫu số reachable với contacted_customers
    if (definition.metric === 'monthly_contact') {
      const pool = reachable(windowedCustomers);
      if (pool.length === 0) {
        return {
          ...base,
          reason: emptyPoolReason,
        };
      }
      const touched = (c: (typeof pool)[number]) =>
        c.days.some((row) => row.zalo_linked && isOutbound(row));
      const passed = pool.filter(touched);
      return {
        ...base,
        status: passed.length > 0 ? 'pass' : 'fail',
        actualValue: passed.length > 0 ? 1 : 0,
        numerator: passed.length,
        denominatorValue: pool.length,
        totalCriteria: pool.length,
        passedCriteria: passed.length,
        byTier: tierBreakdown(pool, (c) => c.tier, touched),
      };
    }

    if (definition.metric === SUGGESTION_ACK_METRIC) {
      // Khách "được đánh giá" = có ngày đo được TRONG khoảng xem; nhưng bài
      // test "bị bỏ bê ≥7 ngày rồi nhắn lại" cần LỊCH SỬ TRƯỚC fromDate —
      // countSuggestionHandled tự chỉ tính ngày >= fromDate trên mảng đầy đủ
      const evaluated = customers.filter((c) =>
        c.days.some((row) => row.stat_date >= fromDate && row.zalo_linked),
      );
      if (evaluated.length === 0) {
        return {
          ...base,
          reason: saleOnline ? REASON_NO_ZALO_LINK : REASON_SALE_OFFLINE,
        };
      }
      const handled = (c: (typeof evaluated)[number]) =>
        this.countSuggestionHandled(c.days, fromDate) > 0;
      const passed = evaluated.filter(handled);
      return {
        ...base,
        status: passed.length > 0 ? 'pass' : 'fail',
        actualValue: passed.length > 0 ? 1 : 0,
        totalCriteria: evaluated.length,
        passedCriteria: passed.length,
        numerator: passed.length,
        denominatorValue: evaluated.length,
        byTier: tierBreakdown(evaluated, (c) => c.tier, handled),
      };
    }

    return {
      ...base,
      reason: `Chưa hỗ trợ metric "${definition.metric}".`,
    };
  }

  /**
   * Chỉ tiêu áp dụng cho MỘT khách: riêng khách > cấp nhân viên > ngưỡng
   * cấu hình mặc định (mục 5.1.7). Chỉ tiêu ratio không phải doanh số dùng
   * ngưỡng mặc định 100 (%) khi không được cấu hình.
   */
  resolveCustomerTarget(
    definition: KpiDefinition,
    customerTarget: number | null,
    saleTarget: number | null,
  ): number | null {
    const specific = customerTarget ?? saleTarget ?? definition.target_value;
    if (specific !== null && specific !== undefined) return Number(specific);
    if (definition.denominator === KpiDenominator.TARGET_VALUE) return null;
    return definition.scoring_mode === ScoringMode.RATIO ? 100 : null;
  }

  /**
   * Chỉ tiêu cấp nhân viên khi chấm doanh số: = TỔNG các chỉ tiêu riêng của
   * khách hàng nếu có gán riêng (mục 5.1.7), không thì lấy dòng cấp nhân viên,
   * không thì ngưỡng mặc định. Tiêu chí ratio không phải doanh số không có
   * ngưỡng cấu hình thì mặc định 100 (%) — nhất quán với resolveCustomerTarget.
   */
  resolveSaleTarget(
    definition: KpiDefinition,
    customerTargets: number[],
    saleTarget: number | null,
  ): number | null {
    if (
      definition.denominator === KpiDenominator.TARGET_VALUE &&
      customerTargets.length > 0
    ) {
      return customerTargets.reduce((acc, value) => acc + Number(value), 0);
    }
    const direct = saleTarget ?? definition.target_value;
    if (direct !== null && direct !== undefined) return Number(direct);
    if (definition.denominator === KpiDenominator.TARGET_VALUE) return null;
    return definition.scoring_mode === ScoringMode.RATIO ? 100 : null;
  }
}

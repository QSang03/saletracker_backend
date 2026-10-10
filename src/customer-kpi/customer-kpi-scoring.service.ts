import { Injectable } from '@nestjs/common';
import {
  KpiComparison,
  KpiDefinition,
  KpiDenominator,
  ScoringMode,
} from './kpi-definition.entity';

/**
 * Engine chấm điểm KPI — tính LÚC ĐỌC (thiết kế mục 5.3): sửa tiêu chí trên
 * web là hiện ngay ở lần tải báo cáo sau, không đợi cron.
 *
 * Nguồn dữ liệu: `customer_activity_daily` (job Python ghi, NestJS chỉ đọc —
 * đúng tiền lệ sale-response). Mỗi metric một nhánh xử lý (adapter, mục 5.1.6):
 * thêm nhóm phòng ban sau này chỉ là thêm dòng `kpi_definitions`, không sửa
 * engine. Tiêu chí doanh thu chờ API doanh thu — luôn trả no_data kèm reason.
 *
 * BẢNG QUY TẮC ĐÃ CHỐT VỚI NGƯỜI DÙNG (10/06/2026):
 * - support_khach  : một ngày "đạt" khi sale nhắn ≥1 tin (outbound > 0).
 * - lien_lac_phan_hoi: một ngày "đạt" khi có hội thoại 2 chiều — khách nhắn
 *   ≥1 tin VÀ sale nhắn ≥1 tin (inbound > 0 và outbound > 0).
 * - goi_y_thuc_hien: binary. "Được gợi ý ngày D" = khách Key/Non không được
 *   liên lạc bằng tin đi trong SUGGESTION_GAP_DAYS ngày trước đó (bị bỏ bê);
 *   "đã xử lý" = ngày D sale nhắn lại ≥1 tin → tự nhận từ tin nhắn, không cần
 *   bảng gợi ý hay nút bấm (đúng chữ "Tổng hợp từ hoạt động" của thiết kế).
 * - order_count / debt_balance: metric kiểu NGƯỠNG (giá trị tuyệt đối) — chấm
 *   binary so ngưỡng hoặc ratio so chỉ tiêu (chỉ mẫu số target_value; mẫu số
 *   đếm khách không có nghĩa với giá trị tuyệt đối).
 * - revenue_key / revenue_non: luôn no_data — chờ API doanh thu (quyết định
 *   mục 4.4: cố ý không đọc 2 sheet ẩn BCBH/CNO của file Excel).
 * - Cấp khách hàng: chỉ tiêu ratio trả % ngày đạt trong khoảng xem (FE ẩn nếu
 *   không cần — mục 5.1.6); binary trả pass/fail.
 * - Cấp Sale: ratio = "x/y khách đạt" (mẫu số mặc định là khách CÓ THỂ ĐO —
 *   zalo_linked, ngày sale offline không kéo tỉ lệ xuống, mục 5.1.5; cấu hình
 *   denominator = all_customers thì mẫu số là TOÀN BỘ khách trong danh sách);
 *   binary = "x/y khách đạt" trong khoảng xem.
 */

/** Số ngày không được liên lạc thì khách rơi vào danh sách gợi ý (mục 5.4). */
export const SUGGESTION_GAP_DAYS = 7;

/** Nhìn lại bao nhiêu ngày hoạt động để chấm gợi ý ở đầu khoảng xem. */
export const SUGGESTION_LOOKBACK_DAYS = SUGGESTION_GAP_DAYS;

export const REASON_NO_REVENUE_SOURCE = 'Chưa có nguồn dữ liệu doanh thu.';
export const REASON_SALE_OFFLINE =
  'Sale chưa đăng nhập Zalo. Dữ liệu sẽ tự cập nhật khi Sale đăng nhập lại.';
export const REASON_NO_ZALO_LINK =
  'Chưa có khách hàng nào khớp được tài khoản Zalo.';
export const REASON_NO_CUSTOMERS = 'Sale chưa có khách hàng nào trong danh sách.';

/**
 * Metric kiểu NGƯỠNG — chấm trên giá trị tuyệt đối (số đơn, số dư công nợ)
 * thay vì trên tỉ lệ khách đạt. Nguồn:
 * - order_count  : cột `order_count` của customer_activity_daily (rollup ghi).
 * - debt_balance : tổng `remaining` của bảng `debts` (module công nợ), khớp
 *   theo `customer_raw_code` = mã đối tác SAP của khách; điểm theo thời điểm
 *   hiện tại (không theo ngày).
 */
export const THRESHOLD_METRICS = ['order_count', 'debt_balance'];

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
}

/** Kết quả chấm MỘT tiêu chí cho MỘT khách hàng (màn hình chi tiết / by-sale). */
export interface CustomerCriterion {
  key: string;
  scoringMode: ScoringMode;
  status: 'pass' | 'fail' | 'ratio' | 'no_data';
  actualValue: number | null;
  targetValue: number | null;
  reason?: string;
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
}

const pct = (num: number, den: number): number =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : 0;

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
   */
  scoreCustomer(
    definition: KpiDefinition,
    days: ActivityDayRow[],
    targetValue: number | null,
    fromDate: string,
    debtBalance?: number | null,
  ): CustomerCriterion {
    const base: CustomerCriterion = {
      key: definition.key,
      scoringMode: definition.scoring_mode,
      status: 'no_data',
      actualValue: null,
      targetValue,
    };

    if (
      definition.metric === 'revenue_key' ||
      definition.metric === 'revenue_non'
    ) {
      return { ...base, reason: REASON_NO_REVENUE_SOURCE };
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

    if (definition.metric === 'suggestion_ack') {
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
      const historyStart = Math.max(0, i - SUGGESTION_GAP_DAYS);
      const history = sorted.slice(historyStart, i);
      const stale =
        history.length >= SUGGESTION_GAP_DAYS &&
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
   */
  scoreSale(
    definition: KpiDefinition,
    customers: {
      days: ActivityDayRow[];
      targetValue?: number | null;
      debtBalance?: number | null;
    }[],
    saleTargetValue: number | null,
    saleOnline: boolean,
    fromDate: string,
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

    if (
      definition.metric === 'revenue_key' ||
      definition.metric === 'revenue_non'
    ) {
      return { ...base, reason: REASON_NO_REVENUE_SOURCE };
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
        value: thresholdValueOf(definition.metric, c.days, c.debtBalance),
        target: c.targetValue ?? saleTargetValue,
      }));

      if (definition.scoring_mode === ScoringMode.BINARY) {
        // Không ai có ngưỡng/chi tiêu → chưa cấu hình xong, không kết luật fail
        if (perCustomer.every((pc) => pc.target == null)) {
          return { ...base, reason: 'Chưa cấu hình ngưỡng cho tiêu chí.' };
        }
        const passed = perCustomer.filter(
          (pc) =>
            pc.value != null &&
            pc.target != null &&
            this.compareValue(pc.value, pc.target, definition.comparison),
        );
        return {
          ...base,
          status: passed.length > 0 ? 'pass' : 'fail',
          actualValue: passed.length > 0 ? 1 : 0,
          totalCriteria: pool.length,
          passedCriteria: passed.length,
          numerator: passed.length,
          denominatorValue: pool.length,
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
      const total = perCustomer.reduce(
        (acc, pc) => acc + (pc.value ?? 0),
        0,
      );
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
      const passed = pool.filter((c) =>
        c.days.some((row) => row.zalo_linked && isOutbound(row)),
      );
      if (pool.length === 0) {
        return {
          ...base,
          reason: emptyPoolReason,
        };
      }
      return {
        ...base,
        status: 'ratio',
        actualValue: pct(passed.length, pool.length),
        numerator: passed.length,
        denominatorValue: pool.length,
        totalCriteria: pool.length,
        passedCriteria: passed.length,
      };
    }

    if (definition.metric === 'responded_customers') {
      const pool = reachable(windowedCustomers);
      const passed = pool.filter((c) =>
        c.days.some((row) => row.zalo_linked && isTwoWay(row)),
      );
      if (pool.length === 0) {
        return {
          ...base,
          reason: emptyPoolReason,
        };
      }
      return {
        ...base,
        status: 'ratio',
        actualValue: pct(passed.length, pool.length),
        numerator: passed.length,
        denominatorValue: pool.length,
        totalCriteria: pool.length,
        passedCriteria: passed.length,
      };
    }

    if (definition.metric === 'suggestion_ack') {
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
      const passed = evaluated.filter(
        (c) => this.countSuggestionHandled(c.days, fromDate) > 0,
      );
      return {
        ...base,
        status: passed.length > 0 ? 'pass' : 'fail',
        actualValue: passed.length > 0 ? 1 : 0,
        totalCriteria: evaluated.length,
        passedCriteria: passed.length,
        numerator: passed.length,
        denominatorValue: evaluated.length,
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

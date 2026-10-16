import {
  CustomerCriterion,
  CustomerTierSummary,
  SaleCriterion,
} from './customer-kpi-scoring.service';
import { ScoringMode } from './kpi-definition.entity';

/**
 * Bộ lọc + sắp xếp cho hai endpoint báo cáo KPI, tách khỏi service dưới dạng
 * hàm thuần: không cần DB, không cần Nest, chạy trên dữ liệu đã chấm điểm nên
 * có thể test trực tiếp (xem scripts/test-kpi-report-filter.ts).
 *
 * - `by-sale`: lọc/sắp xếp bảng KHÁCH HÀNG của một sale.
 * - `overview`: đếm + lọc các SALE theo kết quả từng tiêu chí.
 *
 * Trường hợp "thiếu dữ liệu" (null) thì KHÔNG KHỚP bộ lọc và luôn xếp CUỐI
 * khi sắp xếp — trừ khách chưa có tin đi trong cửa sổ, coi như đã bỏ bê lâu
 * nhất (xem KpiFilterContext), và trừ tiêu chí cấp sale không đủ dữ liệu kết
 * luận đạt/không đạt (xem `criterionMet`).
 */

/** Trạng thái chấm một tiêu chí cấp khách hàng. */
export type KpiCriterionStatus = CustomerCriterion['status'];

/** Dòng khách đã chấm — hình dạng tối thiểu bộ lọc cần đọc. */
export interface KpiReportCustomer {
  row: {
    assignmentId: number;
    customerId: number;
    customerCode: string;
    customerName: string | null;
    customerTier: string | null;
    customerRole: string | null;
    departmentSlug: string;
    sapCode: string;
  };
  zaloLinked: boolean;
  /** Kết luận theo loại khách: KEY = đạt cả 4 tiêu chí, NON = đếm x/4. */
  tierSummary: CustomerTierSummary;
  criteria: CustomerCriterion[];
  totals: {
    inbound: number;
    outbound: number;
    orders: number;
    revenue: number;
  };
  /**
   * 'has_revenue' khi khách có phát sinh NKM trong kỳ (≥1 phiếu); 'no_revenue'
   * khi khách thật sự không mua; 'no_data' khi sale chưa tra được mã NKM.
   */
  revenueStatus: 'has_revenue' | 'no_revenue' | 'no_data';
}

/** Bộ lọc đã chuẩn hoá (boolean/number, không còn chuỗi query). */
export interface KpiCustomerFilters {
  tier?: string;
  role?: string;
  department?: string;
  zaloStatus?: 'linked' | 'unlinked';
  sapCode?: string;
  search?: string;
  criterionKey?: string;
  status?: KpiCriterionStatus;
  minRatio?: number;
  hasOrders?: boolean;
  minOrders?: number;
  minRevenue?: number;
  minOutbound?: number;
  minInbound?: number;
  daysSinceContact?: number;
  minDebt?: number;
  hasDebt?: boolean;
  /** Trường hợp đặc biệt hoặc mã tiêu chí đang bật — xem `KPI_SORT_KEYS`. */
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/** Dữ liệu ngoài dòng khách mà bộ lọc/sắp xếp cần (service nạp sẵn). */
export interface KpiFilterContext {
  /**
   * Số ngày chưa có tin sale gửi đi, theo assignmentId, tính tới ngày `to`.
   * Khách không có tin nào trong toàn bộ cửa sổ → ít nhất bằng độ dài cửa
   * sổ, service ghi `Number.MAX_SAFE_INTEGER` (không dùng null để sắp xếp
   * không phải đoán "thiếu dữ liệu").
   */
  daysSinceContact: Map<number, number>;
  /** Số dư công nợ theo customerId — `null` = không xác định được khách. */
  debtBalances: Map<number, number | null>;
}

/** Cột sắp xếp cố định; ngoài ra chấp nhận mã tiêu chí đang bật. */
export const KPI_SORT_KEYS = [
  'tier',
  'tierSummary',
  'role',
  'customerCode',
  'customerName',
  'revenue',
  'orders',
  'inbound',
  'outbound',
  'zaloLinked',
  'daysSinceContact',
  'debtBalance',
] as const;

const TIER_RANK: Record<string, number> = { KEY: 0, NON: 1 };
const ROLE_RANK: Record<string, number> = { CHINH: 0, PHU: 1 };

const matchesIdentity = (
  customer: KpiReportCustomer,
  filters: KpiCustomerFilters,
): boolean => {
  const tier = filters.tier?.toUpperCase();
  if (tier && customer.row.customerTier?.toUpperCase() !== tier) return false;

  const role = filters.role?.toUpperCase();
  if (role && customer.row.customerRole?.toUpperCase() !== role) return false;

  if (
    filters.department &&
    customer.row.departmentSlug !== filters.department
  ) {
    return false;
  }

  if (filters.zaloStatus === 'linked' && !customer.zaloLinked) return false;
  if (filters.zaloStatus === 'unlinked' && customer.zaloLinked) return false;

  if (
    filters.sapCode &&
    customer.row.sapCode.toUpperCase() !== filters.sapCode.toUpperCase()
  ) {
    return false;
  }

  return true;
};

const matchesSearch = (
  customer: KpiReportCustomer,
  search: string,
): boolean => {
  if (!search) return true;
  return (
    customer.row.customerCode.toLowerCase().includes(search) ||
    (customer.row.customerName ?? '').toLowerCase().includes(search) ||
    customer.row.sapCode.toLowerCase().includes(search)
  );
};

const criterionValueAtLeast = (
  criteria: CustomerCriterion[],
  key: string | undefined,
  predicate: (criterion: CustomerCriterion) => boolean,
): boolean => {
  const scope = key ? criteria.filter((c) => c.key === key) : criteria;
  // Khoanh đúng một tiêu chí mà tiêu chí đó không tồn tại (đã đổi cấu hình
  // giữa lúc FE đang mở trang) → không khớp, thay vì "khớp tất cả".
  if (key && scope.length === 0) return false;
  return scope.some(predicate);
};

const matchesCriteria = (
  customer: KpiReportCustomer,
  filters: KpiCustomerFilters,
): boolean => {
  if (filters.status !== undefined) {
    const ok = criterionValueAtLeast(
      customer.criteria,
      filters.criterionKey,
      (c) => c.status === filters.status,
    );
    if (!ok) return false;
  }

  if (filters.minRatio !== undefined) {
    const ok = criterionValueAtLeast(
      customer.criteria,
      filters.criterionKey,
      (c) => c.actualValue !== null && c.actualValue >= (filters.minRatio ?? 0),
    );
    if (!ok) return false;
  }

  return true;
};

const matchesActivity = (
  customer: KpiReportCustomer,
  filters: KpiCustomerFilters,
  context: KpiFilterContext,
): boolean => {
  if (filters.hasOrders === true && customer.totals.orders <= 0) return false;
  if (filters.hasOrders === false && customer.totals.orders > 0) return false;
  if (
    filters.minOrders !== undefined &&
    customer.totals.orders < filters.minOrders
  ) {
    return false;
  }
  if (
    filters.minRevenue !== undefined &&
    customer.totals.revenue < filters.minRevenue
  ) {
    return false;
  }
  if (
    filters.minInbound !== undefined &&
    customer.totals.inbound < filters.minInbound
  ) {
    return false;
  }
  if (
    filters.minOutbound !== undefined &&
    customer.totals.outbound < filters.minOutbound
  ) {
    return false;
  }

  if (filters.daysSinceContact !== undefined) {
    // Không có tin đi trong cửa sổ → coi như bỏ bê lâu nhất, khớp mọi ngưỡng
    const days =
      context.daysSinceContact.get(customer.row.assignmentId) ??
      Number.POSITIVE_INFINITY;
    if (days < filters.daysSinceContact) return false;
  }

  if (filters.minDebt !== undefined) {
    const debt = context.debtBalances.get(customer.row.customerId) ?? null;
    if (debt === null || debt < filters.minDebt) return false;
  }
  if (filters.hasDebt === true) {
    const debt = context.debtBalances.get(customer.row.customerId) ?? null;
    if (debt === null || debt <= 0) return false;
  }
  if (filters.hasDebt === false) {
    const debt = context.debtBalances.get(customer.row.customerId) ?? null;
    if (debt === null || debt > 0) return false;
  }

  return true;
};

/**
 * Lọc danh sách khách đã chấm. Các filter được AND với nhau; `search` chỉ
 * khớp khi chuỗi không rỗng. Response cuối vẫn phân trang SAU bước này.
 */
export function filterKpiCustomers(
  customers: KpiReportCustomer[],
  filters: KpiCustomerFilters,
  context: KpiFilterContext,
): KpiReportCustomer[] {
  const search = (filters.search ?? '').trim().toLowerCase();
  return customers.filter(
    (customer) =>
      matchesIdentity(customer, filters) &&
      matchesSearch(customer, search) &&
      matchesCriteria(customer, filters) &&
      matchesActivity(customer, filters, context),
  );
}

/**
 * Giá trị so sánh của một dòng theo `sortBy`; `null`/`undefined` = không có
 * dữ liệu, luôn xếp CUỐI bất kể chiều sắp xếp.
 */
const sortValueOf = (
  customer: KpiReportCustomer,
  sortBy: string,
  context: KpiFilterContext,
): number | string | null => {
  switch (sortBy) {
    case 'tier':
      return TIER_RANK[customer.row.customerTier?.toUpperCase() ?? ''] ?? null;
    case 'tierSummary':
      // Tỷ lệ đạt theo loại khách: KEY = đạt cả 4 tiêu chí, NON = đếm x/4.
      // Không có tiêu chí áp dụng → null (xếp cuối).
      return customer.tierSummary.applicable > 0
        ? customer.tierSummary.passed / customer.tierSummary.applicable
        : null;
    case 'role':
      return ROLE_RANK[customer.row.customerRole?.toUpperCase() ?? ''] ?? null;
    case 'customerCode':
      return customer.row.customerCode || null;
    case 'customerName':
      return customer.row.customerName || null;
    case 'revenue':
      return customer.totals.revenue;
    case 'orders':
      return customer.totals.orders;
    case 'inbound':
      return customer.totals.inbound;
    case 'outbound':
      return customer.totals.outbound;
    case 'zaloLinked':
      return customer.zaloLinked ? 1 : 0;
    case 'daysSinceContact':
      return (
        context.daysSinceContact.get(customer.row.assignmentId) ??
        Number.POSITIVE_INFINITY
      );
    case 'debtBalance':
      return context.debtBalances.get(customer.row.customerId) ?? null;
    default:
      // Mã tiêu chí — sắp theo actualValue (pass/fail = 1/0, ratio = %,
      // no_data = null nên rơi xuống cuối)
      return (
        customer.criteria.find((c) => c.key === sortBy)?.actualValue ?? null
      );
  }
};

/**
 * Sắp xếp bản sao của danh sách (không mutate mảng của service). Không truyền
 * `sortBy` → giữ nguyên thứ tự hiện tại, tương thích response cũ.
 */
export function sortKpiCustomers(
  customers: KpiReportCustomer[],
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc' | undefined,
  context: KpiFilterContext,
): KpiReportCustomer[] {
  if (!sortBy) return customers;
  const direction = sortOrder === 'desc' ? -1 : 1;
  return [...customers].sort((a, b) => {
    const va = sortValueOf(a, sortBy, context);
    const vb = sortValueOf(b, sortBy, context);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') {
      return (va - vb) * direction;
    }
    return String(va).localeCompare(String(vb), 'vi') * direction;
  });
}

// ------------------------------------------------------------ overview
// Tổng hợp + lọc SALE theo tiêu chí. Dataset đã chấm điểm từ `overview()`,
// nên phần này không tốn query và không đổi luật chấm.

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Giá trị % của một tiêu chí cấp sale — dùng cho lọc `minRatio` và cột
 * "trung bình" của `summary`.
 *
 * Tiêu chí doanh số là trường hợp đặc biệt: `actualValue` là TỶ LỆ Key/Non
 * (pivot), không phải % đạt. % cần so sánh với mốc 100 là `achievedPct` (% đạt
 * so chỉ tiêu quý); khoảng xem không trọn quý thì chưa có số này (chỉ có doanh
 * thu thực) nên trả `null` để không khớp bộ lọc, đúng kiểu "thiếu dữ liệu".
 */
export const saleCriterionPct = (criterion: SaleCriterion): number | null => {
  if (criterion.revenue) return criterion.revenue.achievedPct;
  return criterion.actualValue;
};

/**
 * Một tiêu chí ở cấp SALE có "đạt" hay không — dùng cho cả bộ đếm `summary`
 * và bộ lọc `met`.
 *
 * `null` = KHÔNG đủ dữ liệu kết luận (`status: no_data`): không xếp vào đạt
 * lẫn không đạt, để khỏi biến "sale chưa đăng nhập Zalo" thành "sale không
 * đạt". Luật khớp với cách engine đang chấm:
 * - binary: đúng theo `status` (pass = có ≥1 khách đạt).
 * - doanh số: theo kết luận của TIÊU CHÍ QUÝ — `(Dso Key + Dso Non) / target
 *   quý ≥ 100%`. Khoảng xem là tuần/tháng thì không so target nên `null`.
 * - ratio: `actualValue` luôn là %, nên KHÔNG so với `targetValue` khi mẫu số
 *   là `target_value` (targetValue ở đó là số tuyệt đối — chỉ tiêu doanh thu
 *   chẳng hạn) mà lấy mốc 100 = hoàn thành chỉ tiêu. Các mẫu số đếm khách thì
 *   `targetValue` vốn đã là % cần đạt (mặc định 100).
 */
export function criterionMet(criterion: SaleCriterion): boolean | null {
  if (criterion.status === 'no_data') return null;
  if (criterion.revenue) {
    return criterion.revenue.verdict === null
      ? null
      : criterion.revenue.verdict === 'pass';
  }
  if (criterion.scoringMode === ScoringMode.BINARY) {
    return criterion.status === 'pass';
  }
  const target =
    criterion.denominator === 'target_value'
      ? 100
      : (criterion.targetValue ?? 100);
  return criterion.actualValue !== null && criterion.actualValue >= target;
}

/** Một dòng của `summary` — số liệu của MỘT tiêu chí trên MỘT tập sale. */
export interface KpiCriterionSummary {
  key: string;
  name: string;
  scoringMode: ScoringMode;
  denominator: SaleCriterion['denominator'];
  /** Tổng sale trong tập (đã khớp `saleId` + `search`). */
  totalSales: number;
  /** Sale đạt tiêu chí (binary: `status = pass`; ratio: đạt chỉ tiêu). */
  metSales: number;
  /** Sale có dữ liệu nhưng chưa đạt. */
  notMetSales: number;
  /** Sale thiếu dữ liệu — đếm RIÊNG, không nằm trong đạt/không đạt. */
  noDataSales: number;
  /**
   * Trung bình `actualValue` các sale CÓ dỮ LIỆU — chỉ tiêu chí ratio
   * (binary thì 1/0 không có ý nghĩa nào để lấy trung bình).
   */
  avgActualValue: number | null;
}

/**
 * Đếm kết quả từng tiêu chí trên danh sách tiêu chí CẤP SALE của nhiều sale.
 *
 * Thứ tự giữ nguyên thứ tự tiêu chí của sale đầu tiên (= thứ tự
 * `kpi_definitions`), tiêu chí chỉ xuất hiện ở sale sau thì nối thêm vào cuối.
 */
export function summarizeKpiSales(
  criteriaBySale: SaleCriterion[][],
): KpiCriterionSummary[] {
  const order: string[] = [];
  const meta = new Map<string, SaleCriterion>();
  const counters = new Map<
    string,
    {
      met: number;
      notMet: number;
      noData: number;
      sum: number;
      counted: number;
    }
  >();

  for (const criteria of criteriaBySale) {
    for (const criterion of criteria) {
      if (!meta.has(criterion.key)) {
        order.push(criterion.key);
        meta.set(criterion.key, criterion);
        counters.set(criterion.key, {
          met: 0,
          notMet: 0,
          noData: 0,
          sum: 0,
          counted: 0,
        });
      }
      const counter = counters.get(criterion.key)!;
      const met = criterionMet(criterion);
      if (met === null) {
        counter.noData += 1;
      } else if (met) {
        counter.met += 1;
      } else {
        counter.notMet += 1;
      }
      if (criterion.revenue) {
        // Tiêu chí doanh số: cột trung bình phải là % ĐẠT so chỉ tiêu quý,
        // không phải tỷ lệ Key/Non của `actualValue`.
        const achieved = criterion.revenue.achievedPct;
        if (achieved !== null) {
          counter.sum += achieved;
          counter.counted += 1;
        }
      } else if (criterion.actualValue !== null) {
        counter.sum += criterion.actualValue;
        counter.counted += 1;
      }
    }
  }

  return order.map((key) => {
    const counter = counters.get(key)!;
    const criterion = meta.get(key)!;
    const hasData = counter.met + counter.notMet;
    return {
      key,
      name: criterion.name,
      scoringMode: criterion.scoringMode,
      denominator: criterion.denominator,
      totalSales: hasData + counter.noData,
      metSales: counter.met,
      notMetSales: counter.notMet,
      noDataSales: counter.noData,
      avgActualValue:
        criterion.scoringMode === ScoringMode.RATIO && counter.counted > 0
          ? round1(counter.sum / counter.counted)
          : null,
    };
  });
}

/** Bộ lọc theo kết quả MỘT tiêu chí ở cấp sale. */
export interface KpiSaleFilters {
  /** Khoanh đúng một tiêu chí; bỏ trống = "bất kỳ tiêu chí nào". */
  criterionKey?: string;
  /** Đạt / không đạt — `no_data` không khớp 2 chiều. */
  met?: boolean;
  /**
   * Ngưỡng % đạt — tiêu chí doanh số đọc `achievedPct` (% so chỉ tiêu quý),
   * các tiêu chí khác đọc `actualValue`.
   */
  minRatio?: number;
  status?: SaleCriterion['status'];
}

/**
 * Lọc danh sách sale đã chấm (cấp SALE) theo tiêu chí. Các điều kiện AND với
 * nhau. Khoanh một tiêu chí không có trong dữ liệu (đổi cấu hình giữa lúc FE
 * đang mở trang) → không khớp sale nào, thay vì "khớp tất cả".
 */
export function filterKpiSales<T extends { criteria: SaleCriterion[] }>(
  sales: T[],
  filters: KpiSaleFilters,
): T[] {
  if (
    filters.met === undefined &&
    filters.minRatio === undefined &&
    filters.status === undefined
  ) {
    return sales;
  }
  return sales.filter((sale) => {
    const scope = filters.criterionKey
      ? sale.criteria.filter((c) => c.key === filters.criterionKey)
      : sale.criteria;
    if (filters.criterionKey && scope.length === 0) return false;

    if (filters.status !== undefined) {
      if (!scope.some((c) => c.status === filters.status)) return false;
    }

    if (filters.minRatio !== undefined) {
      const ok = scope.some(
        (c) =>
          saleCriterionPct(c) !== null &&
          (saleCriterionPct(c) as number) >= (filters.minRatio ?? 0),
      );
      if (!ok) return false;
    }

    if (filters.met !== undefined) {
      const ok = scope.some((c) => criterionMet(c) === filters.met);
      if (!ok) return false;
    }

    return true;
  });
}

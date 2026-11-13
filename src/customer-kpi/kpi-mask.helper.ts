/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

/**
 * Mask dữ liệu KPI theo chính sách:
 * - `self`: chính sale → full (kể cả thưởng).
 * - `outcome`: role khác → **thưởng/clawback luôn null**; doanh số phụ thuộc
 *   công tắc admin:
 *     - `full` (mặc định): xem số doanh số/doanh thu/target như bình thường.
 *     - `percent`: chỉ xem % (key share, % đạt); mọi số tiền tuyệt đối = null.
 *
 * Các hàm là pure mutation trên object response, không truy vấn DB.
 */

export const REVENUE_CRITERION_KEYS = new Set(['doanh_so_key', 'doanh_so_non']);

/** Field sắp xếp/lọc theo số tiền tuyệt đối — chặn ở chế độ `percent`. */
export const ABSOLUTE_MONEY_SORT_KEYS = new Set(['debtBalance']);

export type RevenueViewMode = 'full' | 'percent';

export function isRevenueCriterionKey(key: unknown): boolean {
  return typeof key === 'string' && REVENUE_CRITERION_KEYS.has(key);
}

/**
 * Chế độ percent: ẩn số tiền tuyệt đối, giữ tỷ lệ.
 * `SaleRevenueRow` / object `revenue` của một sale.
 */
export function maskRevenueObjectPercent(revenue: any): void {
  if (!revenue || typeof revenue !== 'object') return;
  revenue.dsoKey = null;
  revenue.dsoNon = null;
  revenue.quarterTarget = null;
  // Giữ: keyShareRatio/keySharePct/nonSharePct/achievedRatio/achievedPct/verdict
}

/**
 * Criteria cấp SALE — ở chế độ percent:
 * - doanh số: ẩn numerator/denominator/target/quantity/lineTotal;
 *   GIỮ `actualValue` (với doanh_so_key/non đây là key share %).
 */
export function maskSaleCriteriaPercent(criteria: any[]): void {
  for (const criterion of criteria ?? []) {
    if (!criterion) continue;
    if (criterion.revenue) maskRevenueObjectPercent(criterion.revenue);
    if (isRevenueCriterionKey(criterion.key)) {
      criterion.numerator = null;
      criterion.denominatorValue = null;
      criterion.targetValue = null;
      if ('quantity' in criterion) criterion.quantity = null;
      if ('lineTotal' in criterion) criterion.lineTotal = null;
    }
    if (criterion.orderSuggestion) {
      criterion.orderSuggestion.totalValue = null;
    }
  }
}

/** Criteria cấp KHÁCH — ẩn số lượng/giá trị tuyệt đối; giữ actualValue 0/1. */
export function maskCustomerCriteriaPercent(criteria: any[]): void {
  for (const criterion of criteria ?? []) {
    if (!criterion) continue;
    if (isRevenueCriterionKey(criterion.key)) {
      if ('quantity' in criterion) criterion.quantity = null;
      if ('lineTotal' in criterion) criterion.lineTotal = null;
    }
    if ('openOrderValue' in criterion) criterion.openOrderValue = null;
  }
}

/** Một dòng khách trong `by-sale` — chỉ gọi ở chế độ percent. */
export function maskCustomerPercent(customer: any): void {
  if (!customer) return;
  if (customer.totals) {
    customer.totals.revenue = null;
    customer.totals.nkmQuantity = null;
  }
  if (customer.quote) customer.quote.lastQuoteAmount = null;
  maskCustomerCriteriaPercent(customer.criteria ?? []);
}

/** Một entry sale trong overview/export/by-sale — chỉ gọi ở chế độ percent. */
export function maskSaleDataPercent(data: any): void {
  if (!data) return;
  maskSaleCriteriaPercent(data.criteria ?? []);
  if (data.revenue) maskRevenueObjectPercent(data.revenue);
  for (const customer of data.customers ?? []) maskCustomerPercent(customer);
}

/**
 * `KpiMonthlyResult`: tiền thưởng là lương → **luôn** mask với người khác,
 * không phụ thuộc công tắc doanh số.
 */
export function maskMonthlySalary(row: any): any {
  if (row && 'bonus_amount' in row) row.bonus_amount = null;
  return row;
}

/**
 * `KpiQuarterlySettlement`:
 * - `monthly_bonus_total`, `clawback_amount` là lương → luôn mask.
 * - `target_value`, `actual_revenue`, `snapshot` là doanh số → chỉ mask ở
 *   chế độ percent; luôn thêm `achievedPct` để xem % khi bị mask.
 */
export function maskQuarterRow(row: any, mode: RevenueViewMode): any {
  if (!row) return row;
  const target = Number(row.target_value) || 0;
  const actual = Number(row.actual_revenue) || 0;
  row.achievedPct =
    target > 0 ? Math.round((actual / target) * 10000) / 100 : null;
  row.monthly_bonus_total = null;
  row.clawback_amount = null;
  if (mode === 'percent') {
    row.target_value = null;
    row.actual_revenue = null;
    row.snapshot = null;
  }
  return row;
}

/**
 * `DailyTrackingResult`: ở percent chỉ ẩn số tuyệt đối, giữ status và
 * `achievedPct` (tính từ target/actual trước khi mask).
 */
export function maskDailyTracking(row: any, mode: RevenueViewMode): any {
  if (!row) return row;
  const target = Number(row.target) || 0;
  const actual = Number(row.actual) || 0;
  row.achievedPct =
    target > 0 ? Math.round((actual / target) * 10000) / 100 : null;
  if (mode === 'percent') {
    row.target = null;
    row.actual = null;
    row.remainingTarget = null;
    row.expectedToDate = null;
    row.dailyTarget = null;
  }
  return row;
}

/** `GET /suggestions` — percent thì ẩn doanh thu khách; full thì giữ. */
export function maskSuggestions(
  result: any,
  viewerSaleId: number,
  mode: RevenueViewMode,
): void {
  if (mode === 'full') return;
  for (const sale of result?.sales ?? []) {
    if (Number(sale.saleId) === Number(viewerSaleId)) continue;
    for (const suggestion of sale.suggestions ?? []) {
      suggestion.revenueCurrent = null;
      suggestion.revenuePrevious = null;
    }
  }
}

/** `GET /customers/:id/response-daily` — percent thì ẩn doanh thu tuyệt đối. */
export function maskCustomerRevenue(result: any, mode: RevenueViewMode): void {
  if (mode === 'full') return;
  for (const row of result.revenueDaily ?? []) {
    row.quantity = null;
    row.lineTotal = null;
  }
  if (result.revenueTotal) {
    result.revenueTotal.quantity = null;
    result.revenueTotal.lineTotal = null;
  }
  for (const row of result.activityDaily ?? []) {
    if ('revenue' in row) row.revenue = null;
  }
}

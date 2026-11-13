/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */

/**
 * Mask dữ liệu tiền cho view `outcome`.
 *
 * Quy tắc (xem KPI-DATA-VISIBILITY-SECURITY.md):
 * - Chỉ chính sale của dòng dữ liệu mới thấy doanh số/doanh thu/target/thưởng.
 * - Manager, PM, View, Admin chỉ thấy `status`/`verdict` + số đếm vận hành.
 *
 * Các hàm ở đây là pure mutation trên object response, không truy vấn DB.
 * Dùng allowlist thủ công: mỗi field tiền phải được set `null` tường minh.
 */

export const REVENUE_CRITERION_KEYS = new Set(['doanh_so_key', 'doanh_so_non']);

/** Field sắp xếp/lọc suy ra doanh thu/công nợ — chặn với view outcome. */
export const MONEY_SORT_KEYS = new Set([
  'doanh_so_key',
  'doanh_so_non',
  'debtBalance',
]);

export function isRevenueCriterionKey(key: unknown): boolean {
  return typeof key === 'string' && REVENUE_CRITERION_KEYS.has(key);
}

/** `SaleRevenueRow` / object `revenue` của một sale. */
export function maskRevenueObject(revenue: any): void {
  if (!revenue || typeof revenue !== 'object') return;
  revenue.dsoKey = null;
  revenue.dsoNon = null;
  revenue.keyShareRatio = null;
  revenue.keySharePct = null;
  revenue.nonSharePct = null;
  revenue.quarterTarget = null;
  revenue.achievedRatio = null;
  revenue.achievedPct = null;
}

/** Criteria cấp SALE — `actualValue` của tiêu chí doanh số là % doanh thu. */
export function maskSaleCriteria(criteria: any[]): void {
  for (const criterion of criteria ?? []) {
    if (!criterion) continue;
    if (criterion.revenue) maskRevenueObject(criterion.revenue);
    if (isRevenueCriterionKey(criterion.key)) {
      criterion.actualValue = null;
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

/** Criteria cấp KHÁCH — `actualValue` 0/1 được giữ (chỉ là đã mua/chưa mua). */
export function maskCustomerCriteria(criteria: any[]): void {
  for (const criterion of criteria ?? []) {
    if (!criterion) continue;
    if (isRevenueCriterionKey(criterion.key)) {
      if ('quantity' in criterion) criterion.quantity = null;
      if ('lineTotal' in criterion) criterion.lineTotal = null;
    }
    if ('openOrderValue' in criterion) criterion.openOrderValue = null;
  }
}

/** Một dòng khách trong `by-sale`. */
export function maskCustomer(customer: any): void {
  if (!customer) return;
  if (customer.totals) {
    customer.totals.revenue = null;
    customer.totals.nkmQuantity = null;
  }
  if (customer.quote) customer.quote.lastQuoteAmount = null;
  maskCustomerCriteria(customer.criteria ?? []);
}

/** Một entry sale trong overview/export/by-sale. */
export function maskSaleData(data: any): void {
  if (!data) return;
  maskSaleCriteria(data.criteria ?? []);
  if (data.revenue) maskRevenueObject(data.revenue);
  for (const customer of data.customers ?? []) maskCustomer(customer);
}

/** `KpiMonthlyResult`: chỉ mask tiền thưởng; coverage counts vẫn giữ. */
export function maskMonthlyRow(row: any): any {
  if (row && 'bonus_amount' in row) row.bonus_amount = null;
  return row;
}

/** `KpiQuarterlySettlement`: mask toàn bộ tiền + snapshot (chứa target/actual). */
export function maskQuarterRow(row: any): any {
  if (!row) return row;
  row.target_value = null;
  row.actual_revenue = null;
  row.monthly_bonus_total = null;
  row.clawback_amount = null;
  row.snapshot = null;
  return row;
}

/** `DailyTrackingResult`. */
export function maskDailyTracking(row: any): any {
  if (!row) return row;
  row.target = null;
  row.actual = null;
  row.remainingTarget = null;
  row.expectedToDate = null;
  row.dailyTarget = null;
  return row;
}

/** `GET /suggestions` — doanh thu của khách trong gợi ý. */
export function maskSuggestions(result: any, viewerSaleId: number): void {
  for (const sale of result?.sales ?? []) {
    if (Number(sale.saleId) === Number(viewerSaleId)) continue;
    for (const suggestion of sale.suggestions ?? []) {
      suggestion.revenueCurrent = null;
      suggestion.revenuePrevious = null;
    }
  }
}

/** `GET /customers/:id/response-daily` — doanh thu NKM theo khách. */
export function maskCustomerRevenue(result: any): void {
  if (!result) return;
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

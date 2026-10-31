export const QUOTE_STATUSES = [
  'draft',
  'sent',
  'won',
  'lost',
  'cancelled',
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUICK_CASE_STATUSES = QUOTE_STATUSES;

export const MATCH_TYPES = [
  'exact',
  'replacement',
  'equivalent',
  'custom',
] as const;

export type QuickQuoteMatchType = (typeof MATCH_TYPES)[number];

export const DEFAULT_BUILD_FOLDER = 'Báo Giá Theo Yêu Cầu';

export const DEFAULT_STATUS_TEXT = 'CHECK KHO NHẬP 1 BUỔI / 1 NGÀY';

/**
 * Quy tắc tính giá đề xuất (áp dụng riêng cho tab Báo Giá Theo Yêu Cầu):
 * - Hàng dưới 1.000.000đ: cộng thêm 20.000đ
 * - Hàng từ 1.000.000đ: cộng 2%
 * - Làm tròn về bội số 1.000đ
 */
export const DEFAULT_PRICING_RULES = {
  lowPriceThreshold: 1_000_000,
  lowPriceMargin: 20_000,
  highPriceMarkupPercent: 2,
  roundTo: 1_000,
};

export type PricingRules = typeof DEFAULT_PRICING_RULES;

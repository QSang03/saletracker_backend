/**
 * Năm tài chính & quý tài chính của công ty (thiết kế §1.2).
 *
 *   Q1 = tháng 4-5-6, Q2 = 7-8-9, Q3 = 10-11-12, Q4 = 1-2-3
 *
 * `fiscalYear` = năm BẮT ĐẦU năm tài chính: 01/04/2026–31/03/2027 là năm tài
 * chính 2026 — đúng tham số `year` của API chỉ tiêu quý.
 *
 * Tính bằng ngày chuỗi `YYYY-MM-DD` theo UTC nên không lệch múi giờ server,
 * dùng chung quy ước với `vn-date.ts`.
 */

/** Tháng dương lịch → quý tài chính (tháng 1-3 thuộc Q4 của năm trước). */
export const FISCAL_MONTH_TO_QUARTER: Record<number, 1 | 2 | 3 | 4> = {
  4: 1,
  5: 1,
  6: 1,
  7: 2,
  8: 2,
  9: 2,
  10: 3,
  11: 3,
  12: 3,
  1: 4,
  2: 4,
  3: 4,
};

export interface FiscalQuarter {
  /** Năm bắt đầu năm tài chính. */
  fiscalYear: number;
  /** 1..4. */
  quarter: number;
  from: string;
  to: string;
  /** Nhãn hiển thị, ví dụ "Q3/2026". */
  label: string;
}

const pad = (value: number): string => String(value).padStart(2, '0');

const toDate = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const fmt = (date: Date): string => date.toISOString().slice(0, 10);

/** Năm tài chính của một ngày (tháng 1-3 thuộc năm tài chính trước). */
export function fiscalYearOf(date: string): number {
  const month = toDate(date).getUTCMonth() + 1;
  return month >= 4
    ? toDate(date).getUTCFullYear()
    : toDate(date).getUTCFullYear() - 1;
}

/** Quý tài chính (1..4) của một ngày. */
export function fiscalQuarterOf(date: string): 1 | 2 | 3 | 4 {
  return FISCAL_MONTH_TO_QUARTER[toDate(date).getUTCMonth() + 1];
}

/** Khoảng ngày của một quý tài chính (`quarter` không hợp lệ → null). */
export function fiscalQuarterRange(
  fiscalYear: number,
  quarter: number,
): FiscalQuarter | null {
  if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) return null;
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000) return null;
  const from =
    quarter === 4
      ? Date.UTC(fiscalYear + 1, 0, 1) // Q4 rơi vào năm dương lịch sau
      : Date.UTC(fiscalYear, quarter * 3, 1);
  const to =
    quarter === 4
      ? Date.UTC(fiscalYear + 1, 2, 31)
      : Date.UTC(fiscalYear, quarter * 3 + 3, 0);
  return {
    fiscalYear,
    quarter,
    from: fmt(new Date(from)),
    to: fmt(new Date(to)),
    label: `Q${quarter}/${fiscalYear}`,
  };
}

/** Quý tài chính hiện tại tính theo ngày cho trước (mặc định hôm nay). */
export function currentFiscalQuarter(today?: string): FiscalQuarter {
  const base = today ?? new Date().toISOString().slice(0, 10);
  return fiscalQuarterRange(fiscalYearOf(base), fiscalQuarterOf(base))!;
}

/**
 * Quý tài chính phủ TRỌN khoảng `[from, to]` — chỉ trả về khi khoảng xem đã
 * chứa cả quý (khoảng bằng đúng quý, hoặc rộng hơn).
 *
 * Chỉ khi đó mới được kết luận đạt/không đạt so với chỉ tiêu quý: xem tuần hay
 * tháng thì chỉ báo cáo doanh thu thực, không chia target (§1.2).
 */
export function fiscalQuarterCovering(
  from: string,
  to: string,
): FiscalQuarter | null {
  if (!from || !to || from > to) return null;
  const candidates = [
    fiscalQuarterRange(fiscalYearOf(from), fiscalQuarterOf(from)),
    fiscalQuarterRange(fiscalYearOf(to), fiscalQuarterOf(to)),
  ].filter((q): q is FiscalQuarter => q !== null);
  for (const quarter of candidates) {
    if (from <= quarter.from && to >= quarter.to) return quarter;
  }
  return null;
}

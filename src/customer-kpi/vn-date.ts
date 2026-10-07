/**
 * Ngày "hôm nay" theo Asia/Ho_Chi_Minh (YYYY-MM-DD).
 *
 * Báo cáo KPI/gợi ý chia theo ngày lịch VN — server đặt UTC (hoặc lệch múi
 * giờ) không được làm lệch "hôm nay" trước 07:00 sáng VN. en-CA cho thẳng
 * định dạng YYYY-MM-DD.
 */
export function vnToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(new Date());
}

/** Cộng/trừ ngày trên chuỗi YYYY-MM-DD — tính bằng UTC nên không lệch múi giờ. */
export function shiftDateStr(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Số ngày giữa hai chuỗi YYYY-MM-DD (later - earlier). */
export function diffDateStr(earlier: string, later: string): number {
  const [ay, am, ad] = earlier.split('-').map(Number);
  const [by, bm, bd] = later.split('-').map(Number);
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000,
  );
}

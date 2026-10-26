/**
 * Các helper format bám sát file gốc saletracker_phucps.html để text copy ra
 * khớp 100% cú pháp SaleTracker/Zalo mà sale đang dùng.
 */

export function formatMoney(value?: number | null): string {
  if (value === null || value === undefined) {
    return '0';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  const rounded = Math.round(numeric);
  const sign = rounded < 0 ? '-' : '';
  const digits = Math.abs(rounded).toString();
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatPrice(value?: number | null, withFv = false): string {
  if (value === null || value === undefined) {
    return 'CALL';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'CALL';
  }
  return withFv ? `${formatMoney(numeric)} fv` : formatMoney(numeric);
}

export function formatWarranty(value?: string | null): string {
  if (!value) {
    return '';
  }
  let display = String(value).trim();
  if (!display) {
    return '';
  }
  let upper = display.toUpperCase();
  if (!upper.includes('BH')) {
    display = `BH ${display}`;
    upper = display.toUpperCase();
  }
  const hasUnit =
    upper.includes('NĂM') ||
    upper.includes('NAM') ||
    upper.includes('THÁNG') ||
    upper.includes('THANG') ||
    upper.includes('YEAR');
  if (!hasUnit) {
    const numeric = parseInt(display.replace(/\D/g, ''), 10);
    if (!Number.isNaN(numeric)) {
      display += numeric > 0 && numeric <= 5 ? ' năm' : ' tháng';
    }
  }
  return display;
}

/**
 * Text tình trạng trong file gốc luôn bắt đầu bằng ";" (vd: ";SẴN HÀNG").
 * Chuẩn hóa lại để renderer không tạo ra "15000000SẴN HÀNG".
 */
export function normalizeStatusText(value?: string | null): string {
  if (!value) {
    return '';
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.startsWith(';') ? trimmed : `;${trimmed}`;
}

export function stripStatusPrefix(value?: string | null): string {
  if (!value) {
    return '';
  }
  return String(value).replace(/^;+/, '').trim();
}

export function stripHtml(value?: string | null): string {
  if (!value) {
    return '';
  }
  const decoded = String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
    .replace(/&hellip;/gi, '…')
    .replace(/&Oslash;/gi, 'Ø')
    .replace(/&oslash;/gi, 'ø')
    .replace(/&Agrave;/gi, 'À')
    .replace(/&agrave;/gi, 'à')
    .replace(/&Eacute;/gi, 'É')
    .replace(/&eacute;/gi, 'é')
    .replace(/&Iacute;/gi, 'Í')
    .replace(/&iacute;/gi, 'í')
    .replace(/&Oacute;/gi, 'Ó')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&Uacute;/gi, 'Ú')
    .replace(/&uacute;/gi, 'ú')
    .replace(/&Yacute;/gi, 'Ý')
    .replace(/&yacute;/gi, 'ý');
  return decoded
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

/**
 * Ghép tên dòng báo giá giống copySingleRow/copySelectedRows:
 * - Nếu P/N rỗng, trùng tên, nằm trong tên hoặc trùng mã HT -> chỉ lấy tên.
 * - Ngược lại: "P/N<TAB>Tên".
 * - Nối thêm " - Mô tả" nếu có.
 */
export function buildNameLine(
  pn?: string | null,
  name?: string | null,
  code?: string | null,
  description?: string | null,
): string {
  const pnClean = (pn || '').trim();
  const nameClean = (name || '').trim();
  const codeClean = (code || '').trim();
  const lowerName = nameClean.toLowerCase();
  const lowerPn = pnClean.toLowerCase();
  const simple =
    !pnClean ||
    lowerPn === lowerName ||
    (!!lowerPn && lowerName.includes(lowerPn)) ||
    lowerPn === codeClean.toLowerCase();

  let line = simple ? nameClean : `${pnClean}\t${nameClean}`;
  const desc = stripHtml(description);
  if (desc && !line.toLowerCase().includes(desc.toLowerCase())) {
    line += ` - ${desc}`;
  }
  return line;
}

export function sumLineTotals(
  items: Array<{ lineTotal?: number | null }>,
): number {
  return items.reduce((sum, item) => {
    const value = Number(item.lineTotal ?? 0);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
}


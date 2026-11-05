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

export function formatPrice(
  value?: number | null,
  withFvOrLabel: boolean | string | null = false,
): string {
  if (value === null || value === undefined) {
    return 'CALL';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'CALL';
  }
  if (typeof withFvOrLabel === 'string') {
    return withFvOrLabel.trim()
      ? `${formatMoney(numeric)} ${withFvOrLabel.trim()}`
      : formatMoney(numeric);
  }
  return withFvOrLabel ? `${formatMoney(numeric)} fv` : formatMoney(numeric);
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

  return simple ? nameClean : `${pnClean}	${nameClean}`;
}

export function sumLineTotals(
  items: Array<{ lineTotal?: number | null }>,
): number {
  return items.reduce((sum, item) => {
    const value = Number(item.lineTotal ?? 0);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
}

/**
 * Bảo hành mặc định của một sản phẩm theo tháng (từ import Excel "MÃ HT"/"TGBH")
 * — dùng làm fallback khi tạo item báo giá mà FE không gửi `warranty` tay.
 */
export function productWarrantyText(
  product?: { warrantyMonths?: number | null } | null,
): string | null {
  const months = product?.warrantyMonths;
  return months !== null && months !== undefined ? `${months} tháng` : null;
}

/**
 * Tự sinh mã sản phẩm cho các dòng/linh kiện nhập thủ công ngoài S1.
 * Ví dụ: "RAM" -> "KHO_RAM", "Nguồn Arrow 500W" -> "KHO_NGUON_ARROW_50"
 */
export function generateAutoProductCode(name?: string | null, existingCodeOrSeed?: string | number | null): string {
  const val = (name || '').trim();
  const clean = val
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 14);

  let suffix = '';
  if (typeof existingCodeOrSeed === 'string' && existingCodeOrSeed) {
    const parts = existingCodeOrSeed.split('_');
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.length >= 3 && lastPart.length <= 6 && /^[A-Z0-9]+$/.test(lastPart)) {
      suffix = lastPart;
    }
  }
  if (!suffix) {
    suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  }

  const isGeneric = !clean || 
    clean.startsWith('LINH_KIEN') || 
    clean.startsWith('SAN_PHAM') || 
    clean.includes('TUY_CHON') || 
    clean.includes('THU_CONG');

  if (isGeneric) {
    return 'HT_' + suffix;
  }

  return 'KHO_' + clean + '_' + suffix;
}

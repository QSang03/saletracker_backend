import * as ExcelJS from 'exceljs';

export type CustomerTierValue = 'KEY' | 'NON';
export type CustomerRoleValue = 'CHINH' | 'PHU';

export interface ParsedAssignment {
  department_slug: string;
  employee_code: string;
  tier: CustomerTierValue;
}

/** Một khách hàng sau khi đọc + gộp trùng (mã, SAP). */
export interface ParsedCustomerRow {
  /** Số dòng Excel thực (1-based) — báo lỗi đúng dòng. */
  row_num: number;
  customer_code: string;
  sap_code: string;
  customer_role: CustomerRoleValue | null;
  debt_limit: number | null;
  assignments: ParsedAssignment[];
  /** Lỗi dòng — apply sẽ bỏ qua các change mang lỗi này, người nhập sửa file rồi nạp lại. */
  errors: string[];
  /** Cảnh báo gộp trùng — chỉ hiển thị, không chặn. */
  warnings: string[];
}

export interface ParseResult {
  criteria: string[];
  customers: ParsedCustomerRow[];
  /** Số dòng dữ liệu có mã khách. */
  rowCount: number;
  /** Số cặp (mã, SAP) xuất hiện nhiều lần trong file. */
  duplicatePairs: number;
}

/** Chuẩn hoá: bỏ dấu (NFD), gom khoảng trắng, uppercase — xử lý cả ký tự ghép "Phụ". */
const norm = (v: unknown): string =>
  String(v ?? '')
    // "Đ/đ" (U+0110) KHÔNG phân giải được bằng NFD — phải thay thủ công,
    // nếu không header "MÃ ĐỐI TÁC SAP" không bao giờ khớp
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

/** Cột phân loại KEY/NON → slug phòng ban (Phụ lục A.4). */
const DEPT_BY_TIER_HEADER: Record<string, string> = {
  'MAY IN': 'may-in',
  'PC - SERVER': 'pc',
  'LINH KIEN': 'linh-kien',
  LAPTOP: 'laptop',
  PTKH1: 'ptkh1',
  PTKH2: 'ptkh2',
};

/** Cột nhân viên S1-* → slug phòng ban. */
const DEPT_BY_EMP_HEADER: Record<string, string> = {
  'S1-MAY IN, MUC IN': 'may-in',
  'S1-PC, LCD': 'pc',
  'S1-PTTT': 'linh-kien',
  'S1-LAPTOP': 'laptop',
  'S1-PTKH1': 'ptkh1',
  'S1-PTKH2': 'ptkh2',
};

/** Đọc giá trị ô về chuỗi — xử lý richText, công thức (lấy result nếu có). */
function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    const anyV = v as any;
    if (Array.isArray(anyV.richText)) {
      return anyV.richText.map((t: any) => t?.text ?? '').join('');
    }
    if ('result' in anyV)
      return anyV.result == null ? '' : String(anyV.result).trim();
    if ('text' in anyV) return String(anyV.text ?? '').trim();
    return '';
  }
  return String(v).trim();
}

/** Đọc giá trị ô về số — công thức không có result cached → null. */
function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  if (v == null) return null;
  const raw =
    typeof v === 'object' && 'result' in (v as any) ? (v as any).result : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Đọc file Excel phân bổ khách hàng theo mẫu `DSKH KDS_CHÍNH PHỤ_KEY NON`:
 * - Sheet "TIÊU CHÍ": danh sách 5 tiêu chí (chỉ đọc để đối chiếu).
 * - Sheet "File Chi Tiết": mỗi dòng → khách hàng (mã, SAP) + phân công tối đa
 *   6 phòng ban (nhân viên + tier Key/Non).
 * Cố ý KHÔNG đọc sheet ẩn BCBH/CNO (doanh thu + master SAP) — thiết kế mục 4.4.
 *
 * Gộp trùng: 2 dòng cùng (mã, SAP) → một khách, phòng nào chưa có thì nhận thêm,
 * trùng phòng nhưng khác nhân viên → giữ dòng ĐẦU + ghi cảnh báo.
 */
export async function parseImportWorkbook(
  buffer: Buffer,
): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs khai báo kiểu Buffer riêng — cast để khớp
  await wb.xlsx.load(buffer as any);

  const ws = wb.getWorksheet('File Chi Tiết');
  if (!ws) throw new Error('Thiếu sheet "File Chi Tiết"');

  const criteria: string[] = [];
  const tc = wb.getWorksheet('TIÊU CHÍ');
  if (tc) {
    tc.eachRow((row) => {
      const t = cellText(row.getCell(1)).trim();
      if (t) criteria.push(t);
    });
  }
  if (criteria.length < 5) {
    throw new Error(
      'Sheet "TIÊU CHÍ" không đúng mẫu (cần ít nhất 5 dòng tiêu chí)',
    );
  }

  // Dò dòng tiêu đề trong 10 dòng đầu — file mẫu nằm ở dòng 1 nhưng không cố định cứng
  let headerRowNum = -1;
  for (let i = 1; i <= Math.min(10, ws.rowCount); i++) {
    const texts: string[] = [];
    ws.getRow(i).eachCell({ includeEmpty: false }, (c) =>
      texts.push(norm(c.value)),
    );
    if (texts.includes('MA KH') && texts.includes('LOAI MA')) {
      headerRowNum = i;
      break;
    }
  }
  if (headerRowNum < 0) {
    throw new Error(
      'Không tìm thấy dòng tiêu đề (cần cột "MÃ KH" và "LOẠI MÃ")',
    );
  }

  // Ghép cột theo header
  const cols: { sap: number; code: number; loai: number; hanMuc: number } = {
    sap: 0,
    code: 0,
    loai: 0,
    hanMuc: 0,
  };
  const tierCols: Array<{ col: number; slug: string }> = [];
  const empCols: Array<{ col: number; slug: string }> = [];
  ws.getRow(headerRowNum).eachCell({ includeEmpty: false }, (cell, col) => {
    const n = norm(cell.value);
    if (!n) return;
    if (n === 'MA DOI TAC SAP') cols.sap = col;
    else if (n === 'MA KH') cols.code = col;
    else if (n === 'LOAI MA') cols.loai = col;
    else if (n === 'HAN MUC') cols.hanMuc = col;
    else if (DEPT_BY_TIER_HEADER[n])
      tierCols.push({ col, slug: DEPT_BY_TIER_HEADER[n] });
    else if (DEPT_BY_EMP_HEADER[n])
      empCols.push({ col, slug: DEPT_BY_EMP_HEADER[n] });
  });

  const missing: string[] = [];
  if (!cols.code) missing.push('"MÃ KH"');
  if (!cols.sap) missing.push('"MÃ ĐỐI TÁC SAP"');
  if (!cols.loai) missing.push('"LOẠI MÃ"');
  if (tierCols.length !== 6) missing.push('6 cột phân loại KEY/NON');
  if (empCols.length !== 6) missing.push('6 cột nhân viên S1-*');
  if (missing.length) {
    throw new Error('File thiếu cột bắt buộc: ' + missing.join(', '));
  }

  const customers = new Map<string, ParsedCustomerRow>();
  const occurrences = new Map<string, number>();
  let rowCount = 0;

  for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const code = cellText(row.getCell(cols.code));
    if (!code) continue; // dòng trống
    rowCount++;

    const sap = cols.sap ? cellText(row.getCell(cols.sap)) : '';
    const errors: string[] = [];
    let customer_role: CustomerRoleValue | null = null;
    const roleRaw = norm(cellText(row.getCell(cols.loai)));
    if (roleRaw === 'CHINH') customer_role = 'CHINH';
    else if (roleRaw === 'PHU') customer_role = 'PHU';
    else errors.push('LOẠI MÃ trống hoặc sai giá trị');

    const debt_limit = cols.hanMuc
      ? cellNumber(row.getCell(cols.hanMuc))
      : null;

    const assignments: ParsedAssignment[] = [];
    for (const { col, slug } of empCols) {
      const raw = cellText(row.getCell(col));
      if (!raw) continue; // phòng không có nhân viên trong dòng này
      const empCode = raw.split('-')[0].trim().toUpperCase();
      if (!empCode) continue;
      const tierCol = tierCols.find((t) => t.slug === slug);
      const tierRaw = tierCol
        ? cellText(row.getCell(tierCol.col)).toLowerCase()
        : '';
      if (tierRaw !== 'key' && tierRaw !== 'non') {
        errors.push(
          `Phòng ${slug}: giá trị phân loại "${tierRaw || '(trống)'}" phải là KEY hoặc NON`,
        );
        continue;
      }
      assignments.push({
        department_slug: slug,
        employee_code: empCode,
        tier: tierRaw.toUpperCase() as CustomerTierValue,
      });
    }

    const key = `${code}|${sap}`;
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    const existed = customers.get(key);
    if (existed) {
      for (const a of assignments) {
        const dup = existed.assignments.find(
          (x) => x.department_slug === a.department_slug,
        );
        if (!dup) {
          existed.assignments.push(a);
        } else if (
          dup.employee_code !== a.employee_code ||
          dup.tier !== a.tier
        ) {
          existed.warnings.push(
            `Dòng ${r}: trùng (mã, SAP) với dòng ${existed.row_num} nhưng phòng ${a.department_slug} khác nhân viên/tier — giữ bản dòng ${existed.row_num}`,
          );
        }
      }
      continue;
    }

    customers.set(key, {
      row_num: r,
      customer_code: code,
      sap_code: sap,
      customer_role,
      debt_limit,
      assignments,
      errors,
      warnings: [],
    });
  }

  return {
    criteria,
    customers: [...customers.values()],
    rowCount,
    // Số CẶP (mã, SAP) xuất hiện nhiều hơn 1 dòng — khớp cách đếm của Phụ lục B
    duplicatePairs: [...occurrences.values()].filter((n) => n > 1).length,
  };
}

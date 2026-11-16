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
  /**
   * Role đọc từ cột "LOẠI MÃ" (CHINH/PHU), hoặc từ cột "Mã" của format mới
   * (MẸ = CHÍNH, CON = PHỤ). Null khi cột vắng trong file (tùy chọn) hoặc ô
   * dòng đó để trống. Null KHÔNG phải lỗi: bước sinh diff tự quyết — tạo mới
   * khách → mặc định CHINH; cập nhật → giữ role cũ, cũ null mới đề xuất CHINH.
   */
  customer_role: CustomerRoleValue | null;
  credit_days: number | null;
  assignments: ParsedAssignment[];
  /** Lỗi dòng — apply sẽ bỏ qua các change mang lỗi này, người nhập sửa file rồi nạp lại. */
  errors: string[];
  /**
   * Phòng CÓ ô phân loại nhưng sai giá trị (không phải KEY/NON). Khác với
   * "phòng để trống": ở đây file có ý định gán phòng đó nhưng không đọc được —
   * bước so khớp không được kết luận phòng ấy bị bỏ rồi xoá phân công đang có.
   */
  invalid_depts: string[];
  /** Cảnh báo gộp trùng — chỉ hiển thị, không chặn. */
  warnings: string[];
}

export interface ParseResult {
  /** Tiêu chí đọc được từ sheet "TIÊU CHÍ" (rỗng nếu file không có sheet này). */
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

/**
 * Tìm sheet theo tên, KHÔNG phân biệt hoa thường (và bỏ khoảng trắng thừa).
 *
 * exceljs `getWorksheet(name)` so khớp tên sheet CÓ phân biệt hoa thường: file
 * có sheet "FILE CHI TIẾT" (một số bản export Excel viết in hoa toàn bộ) sẽ
 * không match "File Chi Tiết" và bị báo thiếu sheet oan.
 */
function findSheet(
  wb: ExcelJS.Workbook,
  name: string,
): ExcelJS.Worksheet | undefined {
  const exact = wb.getWorksheet(name);
  if (exact) return exact;
  const target = norm(name);
  return wb.worksheets.find((s) => norm(s.name) === target);
}

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

/**
 * Header cột mã khách. File chuẩn dùng "MÃ KH", nhưng file thật do manager
 * xuất từ nguồn khác có thể chỉ còn "MÃ" (đã gặp file update 16/11/2026).
 * Các biến thể đều chuẩn hoá về cùng một dạng không dấu.
 */
const CODE_HEADER_ALIASES = new Set([
  'MA KH',
  'MA KHACH HANG',
  'MA KHACH',
  'MA',
]);
const CODE_HEADER_CANONICAL = 'MA KH';

/**
 * Chọn cột mã khách khi file có nhiều cột cùng chuẩn hoá thành "MA".
 *
 * Ví dụ file thật: cột C header "Mã" (giá trị MẸ/CON — phân nhóm) đứng cạnh
 * cột D header "MÃ" (mã khách). Sau khi bỏ dấu cả hai đều thành "MA", nên
 * không thể chọn theo header. Chọn theo dữ liệu:
 * - mã khách luôn chứa "_" (xem customer.entity.ts) → ưu tiên tỉ lệ này;
 * - cột phân nhóm chỉ lặp vài giá trị → độ đa dạng thấp.
 * Cột không đạt ngưỡng tin cậy bị loại để báo thiếu cột thay vì đọc rác.
 */
function pickCodeColumn(
  ws: ExcelJS.Worksheet,
  headerRowNum: number,
  candidates: Array<{ col: number; header: string }>,
): number {
  if (!candidates.length) return 0;
  const canonical = candidates.find((c) => c.header === CODE_HEADER_CANONICAL);
  if (canonical) return canonical.col;

  const lastRow = Math.min(ws.rowCount, headerRowNum + 500);
  let best: { col: number; score: number } | null = null;
  for (const { col } of candidates) {
    let nonEmpty = 0;
    let withUnderscore = 0;
    const distinct = new Set<string>();
    for (let r = headerRowNum + 1; r <= lastRow; r++) {
      const v = cellText(ws.getRow(r).getCell(col));
      if (!v) continue;
      nonEmpty++;
      distinct.add(v);
      if (v.includes('_')) withUnderscore++;
    }
    if (!nonEmpty) continue;
    const score =
      (withUnderscore / nonEmpty) * 2 + distinct.size / nonEmpty;
    if (!best || score > best.score) best = { col, score };
  }
  return best && best.score >= 0.5 ? best.col : 0;
}

/**
 * Cột "Mã" của format mới chứa LOẠI MÃ dạng MẸ/CON (MẸ = CHÍNH, CON = PHỤ),
 * không phải mã khách. Sau khi chọn cột mã khách, cột "MA" còn lại chỉ được
 * nhận là cột role nếu dữ liệu gần như toàn bộ là các giá trị role.
 */
const ROLE_VALUE_TOKENS = new Set(['ME', 'CON', 'CHINH', 'PHU']);

function pickRoleColumn(
  ws: ExcelJS.Worksheet,
  headerRowNum: number,
  candidates: Array<{ col: number; header: string }>,
  codeCol: number,
): number {
  const lastRow = Math.min(ws.rowCount, headerRowNum + 500);
  let best: { col: number; ratio: number } | null = null;
  for (const { col } of candidates) {
    if (col === codeCol) continue;
    let nonEmpty = 0;
    let roleLike = 0;
    for (let r = headerRowNum + 1; r <= lastRow; r++) {
      const v = cellText(ws.getRow(r).getCell(col));
      if (!v) continue;
      nonEmpty++;
      if (ROLE_VALUE_TOKENS.has(norm(v))) roleLike++;
    }
    if (!nonEmpty) continue;
    const ratio = roleLike / nonEmpty;
    if (ratio >= 0.9 && (!best || ratio > best.ratio)) {
      best = { col, ratio };
    }
  }
  return best?.col ?? 0;
}

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
 * - Sheet "File Chi Tiết" (BẮT BUỘC, không phân biệt hoa thường): mỗi dòng →
 *   khách hàng (mã, SAP) + phân công tối đa 6 phòng ban (nhân viên + tier Key/Non).
 * - Sheet "TIÊU CHÍ": chỉ BẮT BUỘC khi hệ thống chưa có tiêu chí nào trong DB
 *   (xem `requireCriteria`); đã có tiêu chí thì thiếu sheet này vẫn nạp được.
 * Cố ý KHÔNG đọc sheet ẩn BCBH/CNO (doanh thu + master SAP) — thiết kế mục 4.4.
 *
 * Cột "LOẠI MÃ" tùy chọn: file cũ thiếu cột này, hoặc dòng nào để trống, đều
 * đọc được — customer_role = null, không báo lỗi (quy tắc mặc định nằm ở bước
 * sinh diff/apply). Format mới dùng cột "Mã" với MẸ = CHÍNH, CON = PHỤ; parser
 * nhận cả hai kiểu. Sai giá trị (non-empty lạ) mới là lỗi của dòng.
 *
 * Gộp trùng: 2 dòng cùng (mã, SAP) → một khách, phòng nào chưa có thì nhận thêm,
 * trùng phòng nhưng khác nhân viên → giữ dòng ĐẦU + ghi cảnh báo.
 */
export async function parseImportWorkbook(
  buffer: Buffer,
  options: { requireCriteria?: boolean } = {},
): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs khai báo kiểu Buffer riêng — cast để khớp
  await wb.xlsx.load(buffer as any);

  const ws = findSheet(wb, 'File Chi Tiết');
  if (!ws) {
    const have = wb.worksheets.map((s) => s.name).join(', ') || '(rỗng)';
    throw new Error(
      `Thiếu sheet "File Chi Tiết" (tên sheet không phân biệt hoa thường). Các sheet trong file: ${have}`,
    );
  }

  // Sheet "TIÊU CHÍ" chỉ cần khi hệ thống CHƯA có tiêu chí nào (options.requireCriteria
  // do service tra DB truyền vào). Đã có tiêu chí rồi thì thiếu sheet này không
  // sao — vẫn đọc thử nếu có, để đối chiếu/hiển thị.
  const criteria: string[] = [];
  const tc = findSheet(wb, 'TIÊU CHÍ');
  if (tc) {
    tc.eachRow((row) => {
      const t = cellText(row.getCell(1)).trim();
      if (t) criteria.push(t);
    });
  }
  if (options.requireCriteria && criteria.length < 5) {
    throw new Error(
      'Hệ thống chưa có tiêu chí nào — file phải có sheet "TIÊU CHÍ" với ít nhất 5 dòng tiêu chí',
    );
  }

  // Dò dòng tiêu đề trong 10 dòng đầu — file mẫu nằm ở dòng 1 nhưng không cố định cứng.
  // Ưu tiên dòng có cả cột SAP lẫn cột mã khách: alias "MÃ" dễ trùng với một ô
  // dữ liệu nào đó ở đầu sheet hơn "MÃ KH" cũ.
  let headerRowNum = -1;
  let codeOnlyRow = -1;
  let sapOnlyRow = -1;
  for (let i = 1; i <= Math.min(10, ws.rowCount); i++) {
    const texts: string[] = [];
    ws.getRow(i).eachCell({ includeEmpty: false }, (c) =>
      // cellText thay vì String(c.value): header rich text là object, String()
      // sẽ ra "[OBJECT OBJECT]" và không bao giờ khớp.
      texts.push(norm(cellText(c))),
    );
    // Cột "LOẠI MÃ" KHÔNG bắt buộc để dò dòng tiêu đề nữa — file thiếu nó
    // vẫn nạp được (role trống → middleware xử lý theo quy tắc mặc định ở
    // bước sinh diff/apply, xem customer-assignments.service.ts).
    const hasCode = texts.some((t) => CODE_HEADER_ALIASES.has(t));
    const hasSap = texts.includes('MA DOI TAC SAP');
    if (hasCode && hasSap) {
      headerRowNum = i;
      break;
    }
    if (hasCode && codeOnlyRow < 0) codeOnlyRow = i;
    if (hasSap && sapOnlyRow < 0) sapOnlyRow = i;
  }
  if (headerRowNum < 0) headerRowNum = codeOnlyRow;
  if (headerRowNum < 0) headerRowNum = sapOnlyRow;
  if (headerRowNum < 0) {
    throw new Error(
      'Không tìm thấy dòng tiêu đề (cần cột "MÃ KH" hoặc "MÃ")',
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
  const codeCandidates: Array<{ col: number; header: string }> = [];
  ws.getRow(headerRowNum).eachCell({ includeEmpty: false }, (cell, col) => {
    const n = norm(cellText(cell));
    if (!n) return;
    if (n === 'MA DOI TAC SAP') cols.sap = col;
    else if (CODE_HEADER_ALIASES.has(n))
      codeCandidates.push({ col, header: n });
    else if (n === 'LOAI MA') cols.loai = col;
    else if (n === 'HAN MUC') cols.hanMuc = col;
    else if (DEPT_BY_TIER_HEADER[n])
      tierCols.push({ col, slug: DEPT_BY_TIER_HEADER[n] });
    else if (DEPT_BY_EMP_HEADER[n])
      empCols.push({ col, slug: DEPT_BY_EMP_HEADER[n] });
  });
  cols.code = pickCodeColumn(ws, headerRowNum, codeCandidates);
  // Format mới dùng cột "Mã" (MẸ/CON) làm LOẠI MÃ; cột chuẩn "LOẠI MÃ" được ưu tiên.
  if (!cols.loai) {
    cols.loai = pickRoleColumn(ws, headerRowNum, codeCandidates, cols.code);
  }

  const missing: string[] = [];
  if (!cols.code) missing.push('"MÃ KH"');
  if (!cols.sap) missing.push('"MÃ ĐỐI TÁC SAP"');
  // "LOẠI MÃ" TÙY CHỌN: thiếu cột (hoặc ô trống) → customer_role = null,
  // apply tự quyết — tạo mới → mặc định CHÍNH, cập nhật → giữ giá trị cũ
  // (cũ là null thì mới gán CHÍNH). Chỉ sai giá trị (non-empty lạ) mới là lỗi.
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
    // LOẠI MÃ: cột vắng (cols.loai = 0) hoặc ô trống → null, KHÔNG báo lỗi —
    // giá trị mặc định do bước sinh diff/apply quyết (tạo mới → CHÍNH,
    // cập nhật → giữ cũ, cũ null mới gán CHÍNH). Sai giá trị vẫn là lỗi.
    let customer_role: CustomerRoleValue | null = null;
    const roleText = cols.loai ? cellText(row.getCell(cols.loai)) : '';
    const roleRaw = norm(roleText);
    // CHÍNH/PHỤ (file chuẩn) hoặc MẸ/CON (cột "Mã" format mới)
    if (roleRaw === 'CHINH' || roleRaw === 'ME') customer_role = 'CHINH';
    else if (roleRaw === 'PHU' || roleRaw === 'CON') customer_role = 'PHU';
    else if (roleRaw) {
      errors.push(
        `LOẠI MÃ sai giá trị "${roleText}" (chỉ nhận CHINH/PHU hoặc MẸ/CON)`,
      );
    }

    // Cột HẠN MỨC = Số ngày công nợ (đã đối chiếu với sheet CNO), không phải tiền
    const credit_days = cols.hanMuc
      ? cellNumber(row.getCell(cols.hanMuc))
      : null;

    const assignments: ParsedAssignment[] = [];
    const invalidDepts: string[] = [];
    for (const { col, slug } of empCols) {
      const raw = cellText(row.getCell(col));
      if (!raw) continue; // phòng không có nhân viên trong dòng này
      // Ô nhân viên bị công thức trả về 0 khi không có người (đã gặp file thật)
      // — coi như trống, không phải mã nhân viên "0".
      if (raw === '0') continue;
      const empCode = norm(raw.split('-')[0]);
      if (!empCode) continue;
      const tierCol = tierCols.find((t) => t.slug === slug);
      const tierRaw = tierCol
        ? cellText(row.getCell(tierCol.col)).toLowerCase()
        : '';
      let tier: CustomerTierValue;
      if (tierRaw === 'key') tier = 'KEY';
      else if (tierRaw === 'non' || !tierRaw) {
        // Ô phân loại để trống = không ghi KEY → mặc định NON (quy tắc nghiệp vụ).
        // Chỉ giá trị lạ (non-empty, không phải key/non) mới là lỗi dòng.
        tier = 'NON';
      } else {
        errors.push(
          `Phòng ${slug}: giá trị phân loại "${tierRaw}" phải là KEY hoặc NON`,
        );
        // Nhớ lại phòng có ô nhưng sai — không suy ra được là "file bỏ phòng này"
        if (!invalidDepts.includes(slug)) invalidDepts.push(slug);
        continue;
      }
      assignments.push({
        department_slug: slug,
        employee_code: empCode,
        tier,
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
      for (const slug of invalidDepts) {
        if (!existed.invalid_depts.includes(slug)) {
          existed.invalid_depts.push(slug);
        }
      }
      continue;
    }

    customers.set(key, {
      row_num: r,
      customer_code: code,
      sap_code: sap,
      customer_role,
      credit_days,
      assignments,
      errors,
      invalid_depts: invalidDepts,
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

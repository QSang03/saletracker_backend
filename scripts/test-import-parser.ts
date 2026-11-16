/**
 * Test nhanh parser nạp danh sách khách (không cần DB/HTTP).
 *
 * Chạy: npm run test:import-parser
 *
 * Các case hồi quy từ file thật 16/11/2026:
 * - Header cột mã khách bị đổi "MÃ KH" -> "MÃ", cạnh cột "Mã" (MẸ/CON).
 * - Ô KEY/NON để trống -> mặc định NON, không báo lỗi.
 * - Ô nhân viên bị công thức trả về 0 -> coi như trống.
 * - Giá trị phân loại lạ (KEYY) vẫn phải báo lỗi dòng.
 */
import * as assert from 'node:assert';
import * as ExcelJS from 'exceljs';
import { parseImportWorkbook } from '../src/customer-kpi/customer-import-parser';

const HEADERS_CANONICAL = [
  'STT',
  'MÃ ĐỐI TÁC SAP',
  'Mã',
  'MÃ KH',
  'S1-MÁY IN, MỰC IN',
  'S1-PC, LCD',
  'S1-PTTT',
  'S1-LAPTOP',
  'S1-PTKH1',
  'S1-PTKH2',
  'LAPTOP',
  'LINH KIỆN',
  'MÁY IN',
  'PC - SERVER',
  'PTKH1',
  'PTKH2',
];

/** Header "MÃ" thay cho "MÃ KH" — đúng kiểu file manager gửi. */
const HEADERS_ALIAS = HEADERS_CANONICAL.map((h) => (h === 'MÃ KH' ? 'MÃ' : h));

async function makeBuffer(
  headers: string[],
  rows: unknown[][],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('FILE CHI TIẾT');
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  // 1) Header "MÃ" + cột "Mã" phân nhóm đứng trước: phải chọn đúng cột D.
  //    Tier trống -> NON; ô nhân viên pc = 0 -> bỏ qua, không tạo lỗi.
  {
    const buffer = await makeBuffer(HEADERS_ALIAS, [
      [
        1,
        'C001',
        'MẸ',
        'CODE_ABC',
        'NKDS01-NV A',
        0,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
    ]);
    const parsed = await parseImportWorkbook(buffer);
    assert.strictEqual(parsed.customers.length, 1);
    const c = parsed.customers[0];
    assert.strictEqual(c.customer_code, 'CODE_ABC');
    assert.strictEqual(c.sap_code, 'C001');
    assert.strictEqual(c.customer_role, 'CHINH', 'MẸ phải map thành CHÍNH');
    assert.deepStrictEqual(c.errors, []);
    assert.deepStrictEqual(
      c.assignments.map((a) => [a.department_slug, a.employee_code, a.tier]),
      [['may-in', 'NKDS01', 'NON']],
      'tier trống phải mặc định NON, ô nhân viên 0 phải bị bỏ qua',
    );
    console.log('OK 1: header "MÃ" + blank tier -> NON + bỏ qua ô 0');
  }

  // 2) Header chuẩn "MÃ KH" vẫn đọc đúng, tier KEY giữ nguyên.
  {
    const buffer = await makeBuffer(HEADERS_CANONICAL, [
      [
        1,
        'C002',
        'CON',
        'CODE_DEF',
        'NKDS02-NV B',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'KEY',
      ],
    ]);
    const parsed = await parseImportWorkbook(buffer);
    const c = parsed.customers[0];
    assert.strictEqual(c.customer_role, 'PHU', 'CON phải map thành PHỤ');
    assert.deepStrictEqual(c.errors, []);
    assert.deepStrictEqual(
      c.assignments.map((a) => [a.department_slug, a.tier]),
      [['may-in', 'KEY']],
    );
    console.log('OK 2: header "MÃ KH" chuẩn vẫn parse đúng');
  }

  // 3) Giá trị phân loại lạ vẫn là lỗi dòng (không âm thầm đổi thành NON).
  {
    const buffer = await makeBuffer(HEADERS_ALIAS, [
      [
        1,
        'C003',
        'MẸ',
        'CODE_GHI',
        'NKDS03-NV C',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'KEYY',
      ],
    ]);
    const parsed = await parseImportWorkbook(buffer);
    const c = parsed.customers[0];
    assert.ok(
      c.errors.some((e) => e.includes('phải là KEY hoặc NON')),
      `phải báo lỗi phân loại, nhận được: ${JSON.stringify(c.errors)}`,
    );
    console.log('OK 3: giá trị lạ (KEYY) vẫn báo lỗi');
  }

  // 4) Thiếu hẳn cột mã khách -> throw (service sẽ map thành HTTP 400).
  {
    const headers = HEADERS_ALIAS.map((h) =>
      h === 'MÃ' || h === 'Mã' ? 'GHI CHU' : h,
    );
    const buffer = await makeBuffer(headers, [[1, 'C004', 'MẸ', '', '']]);
    await assert.rejects(
      () => parseImportWorkbook(buffer),
      /Không tìm thấy dòng tiêu đề|thiếu cột bắt buộc/,
    );
    console.log('OK 4: thiếu cột mã khách -> throw để service trả 400');
  }

  console.log('\nTất cả test parser import đã pass.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

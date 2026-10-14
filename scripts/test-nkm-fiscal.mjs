#!/usr/bin/env node
/**
 * Unit test module năm tài chính (nkm-fiscal.ts) — chạy trên bản build.
 *
 *   npm run build && npm run test:nkm-fiscal
 *
 * Năm tài chính của công ty: Q1 = tháng 4-6, Q2 = 7-8-9, Q3 = 10-11-12, Q4 = tháng
 * 1-3 của NĂM DƯƠNG LỊCH SAU. Năm 2026 = 01/04/2026 → 31/03/2027. Các ca test dày
 * đặc quanh ranh giới đổi quý và đổi năm vì một ngày lệch là cả báo cáo quý lệch.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  currentFiscalQuarter,
  fiscalQuarterCovering,
  fiscalQuarterOf,
  fiscalQuarterRange,
  fiscalYearOf,
  FISCAL_MONTH_TO_QUARTER,
} from '../dist/customer-kpi/nkm-fiscal.js';

void path.join(path.dirname(fileURLToPath(import.meta.url)), '../');

let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
  if (cond) {
    pass += 1;
    console.log('  ok  -', name);
  } else {
    fail += 1;
    console.log('  FAIL-', name, extra !== undefined ? JSON.stringify(extra) : '');
  }
};
const eq = (name, actual, expected) =>
  check(name, actual === expected, { actual, expected });

console.log('-- Năm tài chính & quý tài chính (unit) --');

console.log('\n[F1] Bảng tháng → quý (Q1 = tháng 4-6 … Q4 = tháng 1-3)');
eq('tháng 4 → Q1', FISCAL_MONTH_TO_QUARTER[4], 1);
eq('tháng 6 → Q1', FISCAL_MONTH_TO_QUARTER[6], 1);
eq('tháng 7 → Q2', FISCAL_MONTH_TO_QUARTER[7], 2);
eq('tháng 9 → Q2', FISCAL_MONTH_TO_QUARTER[9], 2);
eq('tháng 10 → Q3', FISCAL_MONTH_TO_QUARTER[10], 3);
eq('tháng 12 → Q3', FISCAL_MONTH_TO_QUARTER[12], 3);
eq('tháng 1 → Q4', FISCAL_MONTH_TO_QUARTER[1], 4);
eq('tháng 3 → Q4', FISCAL_MONTH_TO_QUARTER[3], 4);
check('đủ 12 tháng', Object.keys(FISCAL_MONTH_TO_QUARTER).length === 12);

console.log('\n[F2] Năm tài chính — ranh giới 31/03 và 01/04');
eq('2026-03-31 → năm tài chính 2025', fiscalYearOf('2026-03-31'), 2025);
eq('2026-04-01 → năm tài chính 2026', fiscalYearOf('2026-04-01'), 2026);
eq('2026-06-30 → 2026', fiscalYearOf('2026-06-30'), 2026);
eq('2026-07-01 → 2026', fiscalYearOf('2026-07-01'), 2026);
eq('2026-12-31 → 2026', fiscalYearOf('2026-12-31'), 2026);
eq('2027-01-01 → 2026', fiscalYearOf('2027-01-01'), 2026);
eq('2027-03-31 → 2026', fiscalYearOf('2027-03-31'), 2026);
eq('2027-04-01 → 2027', fiscalYearOf('2027-04-01'), 2027);

console.log('\n[F3] Quý tài chính của một ngày');
eq('2026-10-14 → Q3', fiscalQuarterOf('2026-10-14'), 3);
eq('2026-04-15 → Q1', fiscalQuarterOf('2026-04-15'), 1);
eq('2026-08-02 → Q2', fiscalQuarterOf('2026-08-02'), 2);
eq('2027-02-15 → Q4', fiscalQuarterOf('2027-02-15'), 4);

console.log('\n[F4] Khoảng ngày của từng quý');
let q = fiscalQuarterRange(2026, 1);
eq('Q1 from', q?.from, '2026-04-01');
eq('Q1 to', q?.to, '2026-06-30');
eq('Q1 label', q?.label, 'Q1/2026');
q = fiscalQuarterRange(2026, 2);
eq('Q2 from', q?.from, '2026-07-01');
eq('Q2 to', q?.to, '2026-09-30');
q = fiscalQuarterRange(2026, 3);
eq('Q3 from', q?.from, '2026-10-01');
eq('Q3 to', q?.to, '2026-12-31');
q = fiscalQuarterRange(2026, 4);
eq('Q4 from (năm dương lịch sau)', q?.from, '2027-01-01');
eq('Q4 to', q?.to, '2027-03-31');
check('năm nhuận: Q1/2028 kết thúc 30/06 (2028 nhuận)', fiscalQuarterRange(2028, 1)?.to === '2028-06-30');
check('quý 0 → null', fiscalQuarterRange(2026, 0) === null);
check('quý 5 → null', fiscalQuarterRange(2026, 5) === null);
check('quý 1.5 → null', fiscalQuarterRange(2026, 1.5) === null);
check('năm 1999 → null', fiscalQuarterRange(1999, 1) === null);

console.log('\n[F5] Quý hiện tại theo ngày cho trước');
q = currentFiscalQuarter('2026-10-14');
eq('14/10/2026 → Q3/2026', q.label, 'Q3/2026');
q = currentFiscalQuarter('2026-04-01');
eq('01/04/2026 → Q1/2026', q.label, 'Q1/2026');
q = currentFiscalQuarter('2027-03-31');
eq('31/03/2027 → Q4/2026', q.label, 'Q4/2026');
q = currentFiscalQuarter('2027-01-01');
eq('01/01/2027 → Q4/2026', q.label, 'Q4/2026');

console.log('\n[F6] Khoảng xem có trọn quý không (chỉ khi đó mới so chỉ tiêu)');
eq('đúng quý → quý đó', fiscalQuarterCovering('2026-10-01', '2026-12-31')?.label, 'Q3/2026');
eq('Q1 đúng biên → Q1', fiscalQuarterCovering('2026-04-01', '2026-06-30')?.label, 'Q1/2026');
eq('Q2 đúng biên → Q2', fiscalQuarterCovering('2026-07-01', '2026-09-30')?.label, 'Q2/2026');
eq(
  'Q4 đúng biên (rơi vào năm dương lịch sau) → Q4',
  fiscalQuarterCovering('2027-01-01', '2027-03-31')?.label,
  'Q4/2026',
);
eq('1 ngày trong quý → không trọn', fiscalQuarterCovering('2026-10-14', '2026-10-14'), null);
eq('một tuần trong quý → không trọn', fiscalQuarterCovering('2026-10-05', '2026-10-11'), null);
eq('một tháng trong quý → không trọn', fiscalQuarterCovering('2026-10-01', '2026-10-31'), null);
eq('ngày cuối quý một mình → không trọn', fiscalQuarterCovering('2026-12-31', '2026-12-31'), null);
eq(
  'khoảng bắc cầu 2 quý → không trọn',
  fiscalQuarterCovering('2026-09-30', '2026-10-01'),
  null,
);
eq(
  'rộng hơn quý (28/09→05/01) → không trọn',
  fiscalQuarterCovering('2026-09-28', '2027-01-05'),
  null,
);
eq(
  'cả năm tài chính (01/04→31/12) → không trọn',
  fiscalQuarterCovering('2026-04-01', '2026-12-31'),
  null,
);
eq('bắt đầu trước quý nhưng kết thúc đúng cuối quý → không trọn', fiscalQuarterCovering('2026-09-01', '2026-09-30'), null);
eq('from sau to → null', fiscalQuarterCovering('2026-10-05', '2026-10-01'), null);
eq('chuỗi rỗng → null', fiscalQuarterCovering('', ''), null);
eq('thiếu to → null', fiscalQuarterCovering('2026-10-01', ''), null);

console.log(`\n===== ${pass} pass, ${fail} fail =====`);
process.exit(fail === 0 ? 0 : 1);

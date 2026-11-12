import * as assert from 'node:assert/strict';
import {
  CoverageAssignment,
  CoverageRevenueRow,
  SaleSlpMapping,
  computeMonthlyCoverage,
  computeQuarterSettlement,
} from '../src/customer-kpi/kpi-coverage.calc';
import { KpiMonthlyStatus } from '../src/customer-kpi/kpi-monthly-result.entity';
import { KpiQuarterStatus } from '../src/customer-kpi/kpi-quarterly-settlement.entity';
import {
  fiscalQuarterMonths,
  previousFiscalQuarter,
} from '../src/customer-kpi/nkm-fiscal';
import { WorkingDaysService } from '../src/customer-kpi/working-days.service';

const assignments: CoverageAssignment[] = [
  { saleId: 1, customerCode: 'A', tier: 'KEY' },
  { saleId: 1, customerCode: 'B', tier: 'KEY' },
  { saleId: 1, customerCode: 'C', tier: 'KEY' },
  { saleId: 2, customerCode: 'D', tier: 'KEY' },
  { saleId: 3, customerCode: 'E', tier: 'NON' },
  { saleId: 4, customerCode: 'F', tier: 'KEY' },
  { saleId: 5, customerCode: 'G', tier: 'NON' },
  { saleId: 5, customerCode: 'H', tier: 'NON' },
  { saleId: 6, customerCode: 'I', tier: 'KEY' },
  { saleId: 7, customerCode: 'J', tier: 'KEY' },
  { saleId: 8, customerCode: 'K', tier: 'KEY' },
  { saleId: 8, customerCode: 'L', tier: 'KEY' },
  { saleId: 9, customerCode: 'M', tier: 'KEY' },
  { saleId: 9, customerCode: 'N', tier: 'KEY' },
  { saleId: 10, customerCode: 'O', tier: 'KEY' },
  { saleId: 10, customerCode: 'P', tier: 'KEY' },
  { saleId: 11, customerCode: 'Q', tier: 'KEY' },
];

const revenue: CoverageRevenueRow[] = [
  { slpCode: 101, customerCode: 'A', quantity: 1, lineTotal: 100 },
  { slpCode: 101, customerCode: 'B', quantity: 0, lineTotal: 0 },
  { slpCode: 101, customerCode: 'C', quantity: 2, lineTotal: 200 },
  { slpCode: 103, customerCode: 'E', quantity: 1, lineTotal: 100 },
  { slpCode: 104, customerCode: 'F', quantity: 1, lineTotal: 100 },
  { slpCode: 105, customerCode: 'G', quantity: 1, lineTotal: 100 },
  { slpCode: 106, customerCode: 'I', quantity: 1, lineTotal: 100 },
  { slpCode: 107, customerCode: 'J', quantity: 1, lineTotal: 500 },
  { slpCode: 108, customerCode: 'K', quantity: 1, lineTotal: 100 },
  { slpCode: 109, customerCode: 'M', quantity: 1, lineTotal: 100 },
  { slpCode: 110, customerCode: 'O', quantity: 1, lineTotal: 100 },
  { slpCode: 110, customerCode: 'P', quantity: 1, lineTotal: 100 },
  { slpCode: 111, customerCode: 'Q', quantity: 1, lineTotal: 100 },
];

const mappings: SaleSlpMapping[] = [
  { saleId: 1, slpCodes: [101] },
  { saleId: 2, slpCodes: [102] },
  { saleId: 3, slpCodes: [103] },
  { saleId: 4, slpCodes: [] }, // chưa map được NKM
  { saleId: 5, slpCodes: [105] },
  { saleId: 6, slpCodes: [106] },
  { saleId: 7, slpCodes: [107] },
  { saleId: 8, slpCodes: [108] },
  { saleId: 9, slpCodes: [109] },
  { saleId: 10, slpCodes: [110] },
  { saleId: 11, slpCodes: [111] },
];

// ---------------------------------------------------------------- monthly

const monthly = computeMonthlyCoverage(assignments, revenue, mappings, 60);
assert.equal(monthly.get(1)?.nKey, 3);
assert.equal(monthly.get(1)?.coveredKey, 2);
assert.equal(monthly.get(1)?.coverageRate, 66.67);
assert.equal(monthly.get(1)?.status, KpiMonthlyStatus.PASSED);

assert.equal(monthly.get(2)?.nKey, 1);
assert.equal(monthly.get(2)?.coveredKey, 0);
assert.equal(monthly.get(2)?.status, KpiMonthlyStatus.FAILED);

// Không có khách KEY -> miễn trừ
assert.equal(monthly.get(3)?.status, KpiMonthlyStatus.EXEMPT_NO_KEY);

// Chưa map slpCode -> PENDING, không kết luận trượt oan
assert.equal(monthly.get(4)?.status, KpiMonthlyStatus.PENDING);
assert.equal(monthly.get(4)?.hasMapping, false);

// ---------------------------------------------------------------- quarter

const targets = [
  { saleId: 1, targetValue: 1000, actualValue: 1200, hasTarget: true },
  { saleId: 2, targetValue: 1000, actualValue: 800, hasTarget: true },
  { saleId: 3, targetValue: 1000, actualValue: 1200, hasTarget: true },
  { saleId: 4, targetValue: 1000, actualValue: 800, hasTarget: true },
  { saleId: 5, targetValue: 900, actualValue: 1000, hasTarget: true },
  { saleId: 6, targetValue: 0, actualValue: 0, hasTarget: false },
  { saleId: 7, targetValue: 1000, actualValue: 0, hasTarget: true },
  { saleId: 8, targetValue: 1000, actualValue: 1200, hasTarget: true },
  { saleId: 9, targetValue: 1000, actualValue: 500, hasTarget: true },
  { saleId: 10, targetValue: 1000, actualValue: 1200, hasTarget: true },
  { saleId: 11, targetValue: 1000, actualValue: 800, hasTarget: true },
];

const quarter = computeQuarterSettlement(
  assignments,
  revenue,
  mappings,
  targets,
);
// sale 1: tháng đạt 2/3 (60%) nhưng quý yêu cầu 100% -> trượt quý (clawback case)
assert.equal(quarter.get(1)?.status, KpiQuarterStatus.FAILED_KEY_COVERAGE);
assert.equal(quarter.get(2)?.status, KpiQuarterStatus.FAILED_BOTH);
assert.equal(quarter.get(3)?.status, KpiQuarterStatus.EXEMPT_NO_KEY);
// sale 4 chưa map NKM -> PENDING_DATA, dù target/actual có
assert.equal(quarter.get(4)?.status, KpiQuarterStatus.PENDING_DATA);
assert.equal(quarter.get(4)?.revenueSource, 'missing_mapping');
// sale 5 không có KEY -> chỉ xét doanh số
assert.equal(quarter.get(5)?.status, KpiQuarterStatus.EXEMPT_NO_KEY);
// sale 6 thiếu target
assert.equal(quarter.get(6)?.status, KpiQuarterStatus.PENDING_DATA);
assert.equal(quarter.get(6)?.revenueSource, 'missing_target');
// sale 7 actual S1 = 0 nhưng daily > 0 -> fallback daily
assert.equal(quarter.get(7)?.status, KpiQuarterStatus.FAILED_REVENUE);
assert.equal(quarter.get(7)?.revenueSource, 'daily_fallback');
assert.equal(quarter.get(7)?.actualRevenue, 500);
// sale 8 đạt doanh số nhưng chỉ phủ 1/2 KEY
assert.equal(quarter.get(8)?.status, KpiQuarterStatus.FAILED_KEY_COVERAGE);
// sale 9 trượt cả doanh số lẫn độ phủ
assert.equal(quarter.get(9)?.status, KpiQuarterStatus.FAILED_BOTH);
// sale 10 đủ doanh số + phủ 100% KEY
assert.equal(quarter.get(10)?.status, KpiQuarterStatus.PASSED);
// sale 11 phủ đủ KEY nhưng thiếu doanh số
assert.equal(quarter.get(11)?.status, KpiQuarterStatus.FAILED_REVENUE);

// ---------------------------------------------------------------- fiscal

assert.deepEqual(fiscalQuarterMonths(2026, 1), [
  '2026-04',
  '2026-05',
  '2026-06',
]);
assert.deepEqual(fiscalQuarterMonths(2025, 4), [
  '2026-01',
  '2026-02',
  '2026-03',
]);

assert.equal(previousFiscalQuarter('2026-04-01').label, 'Q4/2025');
assert.equal(previousFiscalQuarter('2026-04-10').label, 'Q4/2025');
assert.equal(previousFiscalQuarter('2026-01-05').label, 'Q3/2025');
assert.equal(previousFiscalQuarter('2026-07-03').label, 'Q1/2026');
assert.equal(previousFiscalQuarter('2026-10-02').label, 'Q2/2026');

// ------------------------------------------------------------ working days

const configs = [
  {
    name: 'system_stopToolConfig',
    value: JSON.stringify({
      monday: [
        { start: '00:00', end: '07:50' },
        { start: '12:00', end: '13:30' },
        { start: '17:45', end: '23:59' },
      ],
      tuesday: [
        { start: '00:00', end: '07:50' },
        { start: '12:00', end: '13:30' },
        { start: '17:45', end: '23:59' },
      ],
      wednesday: [
        { start: '00:00', end: '07:50' },
        { start: '12:00', end: '13:30' },
        { start: '17:45', end: '23:59' },
      ],
      thursday: [
        { start: '00:00', end: '07:50' },
        { start: '12:00', end: '13:30' },
        { start: '17:45', end: '23:59' },
      ],
      friday: [
        { start: '00:00', end: '07:50' },
        { start: '12:00', end: '13:30' },
        { start: '17:45', end: '23:59' },
      ],
      saturday: [
        { start: '00:00', end: '07:50' },
        { start: '12:00', end: '13:30' },
        { start: '16:00', end: '23:59' },
      ],
      sunday: [{ start: '00:00', end: '23:59' }],
    }),
  },
  {
    name: 'holiday_single_day',
    value: JSON.stringify([{ dates: ['2026-11-12'] }]),
  },
  { name: 'holiday_multi_days', value: '[]' },
  { name: 'holiday_separated_days', value: '[]' },
];

const fakeRepo = {
  find: async () => configs,
} as any;
const workingDays = new WorkingDaysService(fakeRepo);

(async () => {
  // 09/11/2026 (Mon) -> 15/11/2026 (Sun): 5 ngày thường + thứ 7 - lễ 12/11
  assert.equal(
    await workingDays.countWorkingDays('2026-11-09', '2026-11-15'),
    5,
  );
  assert.equal(await workingDays.isWorkingDayFor('2026-11-15'), false); // Chủ nhật
  assert.equal(await workingDays.isWorkingDayFor('2026-11-14'), true); // thứ 7
  assert.equal(await workingDays.isWorkingDayFor('2026-11-12'), false); // lễ

  console.log('✅ test-kpi-coverage: tất cả assertion đã pass');
})().catch((error) => {
  console.error('❌ test-kpi-coverage failed:', error);
  process.exit(1);
});

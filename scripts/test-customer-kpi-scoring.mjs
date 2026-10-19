/**
 * Unit test engine chấm điểm KPI — chạy trên bản build (không cần server/DB).
 *
 *   npm run build && npm run test:customer-kpi-scoring
 *
 * Phủ các luật đã chốt (BAO-CAO-KPI-KHACH-HANG.md mục 5.1.5) và các bản vá:
 * phân biệt denominator all_customers, metric kiểu ngưỡng order_count /
 * debt_balance (binary gte/lte + ratio target_value), no_data khi cấu hình
 * thiếu, và hồi quy 5 tiêu chí mặc định.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CustomerKpiScoringService,
  ORDER_SUGGESTION_METRIC,
  ORDER_SUGGESTION_WINDOW_DAYS,
  REASON_NO_REVENUE_DATA,
  REASON_NO_ZALO_LINK,
  REASON_SALE_OFFLINE,
  REASON_NO_CUSTOMERS,
  criterionAppliesToTier,
  rollupRevenue,
} from '../dist/customer-kpi/customer-kpi-scoring.service.js';
import {
  employeeCodeOfLabel,
  saleNameOfLabel,
} from '../dist/customer-kpi/nkm-label.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
void path.join(__dirname, '../'); // giữ import path dùng cho build theo máy

const engine = new CustomerKpiScoringService();
let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
  if (cond) {
    pass += 1;
    console.log('  ok  -', name);
  } else {
    fail += 1;
    console.log(
      '  FAIL-',
      name,
      extra !== undefined ? JSON.stringify(extra) : '',
    );
  }
};

const def = (o) => ({
  team_group: 'kinh-doanh',
  key: 'k',
  name: 'T',
  description: null,
  scoring_mode: 'ratio',
  denominator: null,
  period: 'day',
  target_value: null,
  comparison: null,
  is_active: true,
  sort_order: 1,
  ...o,
});
const day = (d, o = {}) => ({
  stat_date: d,
  inbound_count: o.ib || 0,
  outbound_count: o.ob || 0,
  order_count: o.orders || 0,
  revenue: 0,
  zalo_linked: o.linked !== false,
});
// 2 khách: A liên lạc tốt; B không có ngày nào đo được (sale offline)
const custA = {
  days: [day('2026-10-01', { ob: 3, ib: 1 }), day('2026-10-02', { ob: 1 })],
};
const custB = {
  days: [
    day('2026-10-01', { linked: false }),
    day('2026-10-02', { linked: false }),
  ],
};
const FROM = '2026-10-01';

console.log('-- Engine chấm điểm KPI (unit) --');

console.log(
  '\n[1] denominator reachable_customers (mặc định) — B bị loại khỏi mẫu số',
);
let r = engine.scoreSale(
  def({ metric: 'contacted_customers', denominator: 'reachable_customers' }),
  [custA, custB],
  null,
  false,
  FROM,
);
check('mẫu số = 1 (chỉ A)', r.denominatorValue === 1, r);
check('đạt = 1 (A có tin đi)', r.numerator === 1, r);
check('tỉ lệ 100%', r.actualValue === 100, r);

console.log('\n[2] denominator all_customers — B vào mẫu số nhưng không đạt');
r = engine.scoreSale(
  def({ metric: 'contacted_customers', denominator: 'all_customers' }),
  [custA, custB],
  null,
  false,
  FROM,
);
check('mẫu số = 2 (A+B)', r.denominatorValue === 2, r);
check('đạt vẫn = 1', r.numerator === 1, r);
check('tỉ lệ 50%', r.actualValue === 50, r);
check('status ratio', r.status === 'ratio', r);

console.log('\n[3] responded_customers cũng tôn trọng all_customers');
const custC = { days: [day('2026-10-01', { ob: 2, ib: 0 })] }; // chỉ 1 chiều
r = engine.scoreSale(
  def({ metric: 'responded_customers', denominator: 'all_customers' }),
  [custA, custC, custB],
  null,
  false,
  FROM,
);
check('mẫu số = 3', r.denominatorValue === 3, r);
check('đạt = 1 (chỉ A 2 chiều)', r.numerator === 1, r);

console.log('\n[4] order_count binary gte — ngưỡng 2 đơn/khách');
const custD = {
  days: [day('2026-10-01', { orders: 3 }), day('2026-10-02', { orders: 0 })],
};
const custE = { days: [day('2026-10-01', { orders: 1 })] };
r = engine.scoreCustomer(
  def({
    metric: 'order_count',
    scoring_mode: 'binary',
    comparison: 'gte',
    target_value: 2,
  }),
  custD.days,
  2,
  FROM,
);
check('A: 3 đơn >= 2 → pass', r.status === 'pass', r);
r = engine.scoreCustomer(
  def({
    metric: 'order_count',
    scoring_mode: 'binary',
    comparison: 'gte',
    target_value: 2,
  }),
  custE.days,
  2,
  FROM,
);
check('B: 1 đơn < 2 → fail', r.status === 'fail', r);
check('actualValue = số đơn thật (1)', r.actualValue === 1, r);

console.log('\n[5] order_count binary lte — ít đơn hơn mới đạt');
r = engine.scoreCustomer(
  def({
    metric: 'order_count',
    scoring_mode: 'binary',
    comparison: 'lte',
    target_value: 1,
  }),
  custE.days,
  1,
  FROM,
);
check('1 đơn <= 1 → pass', r.status === 'pass', r);
r = engine.scoreCustomer(
  def({
    metric: 'order_count',
    scoring_mode: 'binary',
    comparison: 'lte',
    target_value: 1,
  }),
  custD.days,
  1,
  FROM,
);
check('3 đơn > 1 → fail', r.status === 'fail', r);

console.log('\n[6] order_count ratio target_value — % chỉ tiêu');
r = engine.scoreCustomer(
  def({
    metric: 'order_count',
    scoring_mode: 'ratio',
    denominator: 'target_value',
  }),
  custD.days,
  5,
  FROM,
);
check('3/5 = 60%', r.actualValue === 60, r);
r = engine.scoreCustomer(
  def({
    metric: 'order_count',
    scoring_mode: 'ratio',
    denominator: 'target_value',
  }),
  custE.days,
  null,
  FROM,
);
check(
  'không có chỉ tiêu → no_data + reason',
  r.status === 'no_data' && !!r.reason,
  r,
);

console.log(
  '\n[7] order_count ratio với mẫu số đếm khách → no_data cảnh báo cấu hình sai',
);
r = engine.scoreCustomer(
  def({
    metric: 'order_count',
    scoring_mode: 'ratio',
    denominator: 'reachable_customers',
  }),
  custD.days,
  5,
  FROM,
);
check('no_data', r.status === 'no_data', r);
check(
  'reason nói rõ mẫu số không áp dụng',
  /reachable_customers/.test(r.reason || ''),
  r,
);

console.log('\n[8] order_count binary không có ngưỡng → no_data');
r = engine.scoreCustomer(
  def({ metric: 'order_count', scoring_mode: 'binary', comparison: 'gte' }),
  custD.days,
  null,
  FROM,
);
check(
  'no_data + reason',
  r.status === 'no_data' && /ngưỡng/.test(r.reason || ''),
  r,
);

console.log('\n[9] debt_balance');
r = engine.scoreCustomer(
  def({
    metric: 'debt_balance',
    scoring_mode: 'binary',
    comparison: 'lte',
    target_value: 1000,
  }),
  custD.days,
  1000,
  FROM,
  500,
);
check('nợ 500 <= 1000 → pass', r.status === 'pass', r);
r = engine.scoreCustomer(
  def({
    metric: 'debt_balance',
    scoring_mode: 'binary',
    comparison: 'lte',
    target_value: 1000,
  }),
  custD.days,
  1000,
  FROM,
  5000,
);
check('nợ 5000 > 1000 → fail', r.status === 'fail', r);
r = engine.scoreCustomer(
  def({
    metric: 'debt_balance',
    scoring_mode: 'binary',
    comparison: 'lte',
    target_value: 1000,
  }),
  custD.days,
  1000,
  FROM,
  null,
);
check(
  'không tra được nợ → no_data',
  r.status === 'no_data' && /công nợ/.test(r.reason || ''),
  r,
);
r = engine.scoreCustomer(
  def({
    metric: 'debt_balance',
    scoring_mode: 'ratio',
    denominator: 'target_value',
  }),
  custD.days,
  400,
  FROM,
  100,
);
check('100/400 = 25%', r.actualValue === 25, r);

console.log('\n[10] debt_balance cấp sale — cộng dồn + đếm khách đạt');
const dcust = [
  { days: custD.days, targetValue: 1000, debtBalance: 500 }, // đạt
  { days: custE.days, targetValue: 1000, debtBalance: 4000 }, // không đạt
  { days: custB.days, targetValue: 1000, debtBalance: null }, // không đo được
];
r = engine.scoreSale(
  def({ metric: 'debt_balance', scoring_mode: 'binary', comparison: 'lte' }),
  dcust,
  null,
  false,
  FROM,
);
check('mẫu số = 2 (bỏ khách không đo được)', r.totalCriteria === 2, r);
check('đạt = 1', r.passedCriteria === 1, r);
check('status pass (có 1 khách đạt)', r.status === 'pass', r);

r = engine.scoreSale(
  def({
    metric: 'debt_balance',
    scoring_mode: 'ratio',
    denominator: 'target_value',
  }),
  dcust,
  3000,
  false,
  FROM,
);
check('tổng nợ đo được = 4500', r.numerator === 4500, r);
check('mẫu số = chỉ tiêu sale 3000', r.denominatorValue === 3000, r);
check('tỉ lệ 150%', r.actualValue === 150, r);

console.log('\n[11] order_count cấp sale ratio — tổng đơn / chỉ tiêu');
r = engine.scoreSale(
  def({
    metric: 'order_count',
    scoring_mode: 'ratio',
    denominator: 'target_value',
  }),
  [
    { days: custD.days, targetValue: 5 },
    { days: custE.days, targetValue: 5 },
  ],
  10,
  false,
  FROM,
);
check('tổng đơn = 4', r.numerator === 4, r);
check('4/10 = 40%', r.actualValue === 40, r);

console.log('\n[12] Không ai có ngưỡng → no_data (không kết luận fail oan)');
r = engine.scoreSale(
  def({ metric: 'order_count', scoring_mode: 'binary', comparison: 'gte' }),
  [{ days: custD.days, targetValue: null }],
  null,
  false,
  FROM,
);
check('no_data', r.status === 'no_data', r);
check('reason ngưỡng', /ngưỡng/.test(r.reason || ''), r);

console.log('\n[13] Hồi quy — các hành vi cũ không đổi');
r = engine.scoreSale(
  def({ metric: 'contacted_customers', denominator: 'reachable_customers' }),
  [],
  null,
  true,
  FROM,
);
check(
  'sale online + không khớp Zalo → no_data',
  r.status === 'no_data' && r.reason === REASON_NO_ZALO_LINK,
  r,
);
r = engine.scoreSale(
  def({ metric: 'contacted_customers', denominator: 'reachable_customers' }),
  [],
  null,
  false,
  FROM,
);
check(
  'sale offline → no_data lý do offline',
  r.status === 'no_data' && r.reason === REASON_SALE_OFFLINE,
  r,
);
r = engine.scoreCustomer(
  def({ metric: 'revenue_key', denominator: 'target_value' }),
  custD.days,
  100,
  FROM,
);
check(
  'revenue không có dữ liệu đồng bộ → no_data kèm lý do',
  r.status === 'no_data' && r.reason === REASON_NO_REVENUE_DATA,
  r,
);
r = engine.scoreCustomer(
  def({ metric: 'suggestion_ack', scoring_mode: 'binary', target_value: 1 }),
  [
    day('2026-10-08', { ob: 1 }),
    ...Array.from({ length: 7 }, (_, i) => day(`2026-10-0${i + 1}`, { ob: 0 })),
  ],
  1,
  '2026-10-08',
);
check('gợi ý: bỏ bê 7 ngày rồi nhắn lại → pass', r.status === 'pass', r);
r = engine.scoreCustomer(
  def({ metric: 'suggestion_ack', scoring_mode: 'binary', target_value: 1 }),
  [day('2026-10-08', { ob: 0 })],
  1,
  '2026-10-08',
);
check('gợi ý: không nhắn → fail', r.status === 'fail', r);
r = engine.scoreCustomer(
  def({ metric: 'contacted_customers', denominator: 'reachable_customers' }),
  [day('2026-10-01', { ob: 2 }), day('2026-10-02', { ob: 0 })],
  null,
  FROM,
);
check(
  'contacted cấp khách vẫn trả %',
  r.status === 'ratio' && r.actualValue === 50,
  r,
);
r = engine.scoreCustomer(
  def({ metric: 'responded_customers', denominator: 'reachable_customers' }),
  [day('2026-10-01', { ob: 2, ib: 1 }), day('2026-10-02', { ob: 0, ib: 5 })],
  null,
  FROM,
);
check(
  'responded cấp khách: 1/2 ngày 2 chiều = 50%',
  r.status === 'ratio' && r.actualValue === 50,
  r,
);
r = engine.scoreSale(
  def({ metric: 'contacted_customers', denominator: 'all_customers' }),
  [],
  null,
  false,
  FROM,
);
check(
  'all_customers + không có khách → no_data lý do riêng',
  r.status === 'no_data' && r.reason === REASON_NO_CUSTOMERS,
  r,
);

// ─── Tiêu chí 3/4 — binary theo tháng (thiết kế TC3/TC4) ───
const mvDay = (d, count, o = {}) => ({
  stat_date: d,
  inbound_count: 0,
  outbound_count: 0,
  order_count: 0,
  revenue: 0,
  zalo_linked: o.linked !== false,
  movement_count: count,
});

console.log(
  '\n[N] Tiêu chí 3 — movement_report (báo cáo di chuyển khớp cú pháp)',
);

r = engine.scoreCustomer(
  def({
    metric: 'movement_report',
    scoring_mode: 'binary',
    target_value: 1,
    period: 'month',
  }),
  [mvDay('2026-10-05', 0), mvDay('2026-10-12', 1)],
  1,
  FROM,
);
check('có tin báo cáo trong tháng → pass', r.status === 'pass', r);

r = engine.scoreCustomer(
  def({
    metric: 'movement_report',
    scoring_mode: 'binary',
    target_value: 1,
    period: 'month',
  }),
  [mvDay('2026-10-05', 0), mvDay('2026-10-12', 0)],
  1,
  FROM,
);
check(
  'không có tin báo cáo → fail (mặc định chưa đạt)',
  r.status === 'fail',
  r,
);

r = engine.scoreCustomer(
  def({
    metric: 'movement_report',
    scoring_mode: 'binary',
    target_value: 1,
    period: 'month',
  }),
  [mvDay('2026-10-12', 2, { linked: false })],
  1,
  FROM,
);
check('báo cáo không cần khớp liên hệ Zalo', r.status === 'pass', r);

r = engine.scoreCustomer(
  def({
    metric: 'movement_report',
    scoring_mode: 'binary',
    target_value: 1,
    period: 'month',
  }),
  [mvDay('2026-09-28', 1)],
  1,
  FROM,
);
check('báo cáo trước cửa sổ → không tính', r.status === 'fail', r);

// mẫu số = TOÀN BỘ khách; C chưa khớp Zalo nhưng có báo cáo vẫn tính đạt
const mvA = { days: [mvDay('2026-10-12', 1)] };
const mvB = { days: [mvDay('2026-10-01', 0, { linked: false })] };
const mvC = { days: [mvDay('2026-10-03', 3, { linked: false })] };
r = engine.scoreSale(
  def({
    metric: 'movement_report',
    scoring_mode: 'binary',
    target_value: 1,
    period: 'month',
  }),
  [mvA, mvB, mvC],
  1,
  false,
  FROM,
);
check(
  'mẫu số = 3 (toàn bộ khách, không gate reachable)',
  r.denominatorValue === 3,
  r,
);
check('x = 2 (A + C, kể C không khớp Zalo)', r.numerator === 2, r);
check('sale đạt khi x > 0', r.status === 'pass', r);

r = engine.scoreSale(
  def({
    metric: 'movement_report',
    scoring_mode: 'binary',
    target_value: 1,
    period: 'month',
  }),
  [mvB],
  1,
  false,
  FROM,
);
check(
  'không khách nào báo cáo → fail, x = 0',
  r.status === 'fail' && r.numerator === 0,
  r,
);

r = engine.scoreSale(
  def({
    metric: 'movement_report',
    scoring_mode: 'binary',
    target_value: 1,
    period: 'month',
  }),
  [],
  1,
  false,
  FROM,
);
check(
  'sale không có khách → no_data',
  r.status === 'no_data' && r.reason === REASON_NO_CUSTOMERS,
  r,
);

console.log(
  '\n[N] Tiêu chí 4 — monthly_contact (sale nhắn tin tới khách trong tháng)',
);

r = engine.scoreCustomer(
  def({
    metric: 'monthly_contact',
    scoring_mode: 'binary',
    target_value: 1,
    period: 'month',
  }),
  [day('2026-10-04', { ob: 1 })],
  1,
  FROM,
);
check('sale nhắn 1 tin, khách không trả lời → pass', r.status === 'pass', r);

r = engine.scoreCustomer(
  def({
    metric: 'monthly_contact',
    scoring_mode: 'binary',
    target_value: 1,
    period: 'month',
  }),
  [day('2026-10-04', { ib: 5, ob: 0 })],
  1,
  FROM,
);
check('chỉ khách nhắn → fail', r.status === 'fail', r);

r = engine.scoreCustomer(
  def({
    metric: 'monthly_contact',
    scoring_mode: 'binary',
    target_value: 1,
    period: 'month',
  }),
  [day('2026-10-04', { ob: 2, linked: false })],
  1,
  FROM,
);
check(
  'không đo được Zalo → no_data (khác fail)',
  r.status === 'no_data' && r.reason === REASON_NO_ZALO_LINK,
  r,
);

r = engine.scoreSale(
  def({
    metric: 'monthly_contact',
    scoring_mode: 'binary',
    target_value: 1,
    period: 'month',
  }),
  [custA, custB],
  1,
  true,
  FROM,
);
check('mẫu số = 1 (chỉ khách đo được)', r.denominatorValue === 1, r);
check('x = 1 (A có tin đi)', r.numerator === 1, r);
check('sale đạt khi x > 0', r.status === 'pass', r);

// ─── Tiêu chí doanh số — API NKM (thiết kế THIET-KE-DOANH-SO-API-NKM.md) ───
const Q3 = {
  fiscalYear: 2026,
  quarter: 3,
  from: '2026-10-01',
  to: '2026-12-31',
  label: 'Q3/2026',
};
const FROM_Q = '2026-10-01';
const KEY_DEF = () =>
  def({
    key: 'doanh_so_key',
    metric: 'revenue_key',
    scoring_mode: 'ratio',
    denominator: 'target_value',
  });
const NON_DEF = () =>
  def({
    key: 'doanh_so_non',
    metric: 'revenue_non',
    scoring_mode: 'ratio',
    denominator: 'target_value',
  });

// Fixture khớp pivot của lead: NKDS33 có 3 khách KEY mua 77.842.135.300, 19 khách NON không mua
const pivotKeyCustomers = [
  { customerId: 1, tier: 'KEY', quantity: 12, lineTotal: 77842135300 },
  { customerId: 2, tier: 'KEY', quantity: 3, lineTotal: 0 },
  { customerId: 3, tier: 'KEY', quantity: 0, lineTotal: 0 },
];
const pivotNonCustomers = [
  { customerId: 4, tier: 'NON', quantity: 0, lineTotal: 0 },
  { customerId: 5, tier: 'NON', quantity: 0, lineTotal: 0 },
];
const PIVOT_INPUT = {
  quarter: Q3,
  quarterTarget: 31500000000,
  customers: [...pivotKeyCustomers, ...pivotNonCustomers],
};

console.log('\n[R1] Tiêu chí doanh số cấp KHÁCH — đạt khi có phát sinh');
r = engine.scoreCustomer(KEY_DEF(), custD.days, null, FROM_Q, null, {
  tier: 'KEY',
  quantity: 4,
  lineTotal: 125000000,
});
check(
  'khách KEY có phiếu → pass',
  r.status === 'pass' && r.actualValue === 1,
  r,
);
check(
  'kèm số phiếu + doanh số của khách',
  r.quantity === 4 && r.lineTotal === 125000000,
  r,
);
r = engine.scoreCustomer(KEY_DEF(), custD.days, null, FROM_Q, null, {
  tier: 'KEY',
  quantity: 0,
  lineTotal: 0,
});
check(
  'khách KEY không phát sinh → fail (bắt buộc có phát sinh)',
  r.status === 'fail',
  r,
);
r = engine.scoreCustomer(KEY_DEF(), custB.days, null, FROM_Q, null, {
  tier: 'KEY',
  quantity: 9,
  lineTotal: 1000,
});
check('không gate khớp liên hệ Zalo — mua là đạt', r.status === 'pass', r);

console.log('\n[R2] Mỗi tiêu chí chỉ chấm đúng loại khách');
r = engine.scoreCustomer(KEY_DEF(), custD.days, null, FROM_Q, null, {
  tier: 'NON',
  quantity: 4,
  lineTotal: 100,
});
check(
  'khách NON chấm doanh_so_key → không áp dụng',
  r.notApplicable === true && r.status === 'no_data',
  r,
);
r = engine.scoreCustomer(NON_DEF(), custD.days, null, FROM_Q, null, {
  tier: 'KEY',
  quantity: 4,
  lineTotal: 100,
});
check(
  'khách KEY chấm doanh_so_non → không áp dụng',
  r.notApplicable === true && r.status === 'no_data',
  r,
);
r = engine.scoreCustomer(KEY_DEF(), custD.days, null, FROM_Q, null, {
  tier: null,
  quantity: 4,
  lineTotal: 100,
});
check(
  'chưa xác định KEY/NON → no_data',
  r.status === 'no_data' && /KEY\/NON/.test(r.reason || ''),
  r,
);
check(
  'criterionAppliesToTier bỏ qua ô không áp dụng',
  !criterionAppliesToTier(r, 'KEY'),
  r,
);

console.log(
  '\n[R3] Tiêu chí doanh số cấp SALE — pivot: Dso Key, Dso Non, tỷ lệ, % đạt',
);
r = engine.scoreSale(KEY_DEF(), [], null, true, FROM_Q, PIVOT_INPUT);
check('Dso Key = 77.842.135.300', r.revenue.dsoKey === 77842135300, r.revenue);
check('Dso Non = 0', r.revenue.dsoNon === 0, r.revenue);
check(
  'tỷ lệ DS Key = 100%',
  r.revenue.keyShareRatio === 1 && r.revenue.keySharePct === 100,
  r.revenue,
);
check('tỷ lệ DS Non = 0%', r.revenue.nonSharePct === 0, r.revenue);
check(
  'Key: 2/3 khách có phát sinh',
  r.revenue.keyCustomers.reached === 2 && r.revenue.keyCustomers.total === 3,
  r.revenue,
);
check(
  'Non: 0/2 khách có phát sinh',
  r.revenue.nonCustomers.reached === 0 && r.revenue.nonCustomers.total === 2,
  r.revenue,
);
check(
  '% đạt = (77,84 tỷ)/31,5 tỷ = 247,12%',
  r.revenue.achievedPct === 247.12,
  r.revenue,
);
check(
  'tỷ lệ đạt = 2,4712 (4 số lẻ)',
  r.revenue.achievedRatio === 2.4712,
  r.revenue,
);
check(
  'kết luận đạt khi >= 100%',
  r.status === 'pass' && r.revenue.verdict === 'pass',
  r,
);
check(
  'numerator = Dso Key, mẫu số = tổng Dso',
  r.numerator === 77842135300 && r.denominatorValue === 77842135300,
  r,
);
check('target quý nạp vào targetValue', r.targetValue === 31500000000, r);

r = engine.scoreSale(NON_DEF(), [], null, true, FROM_Q, PIVOT_INPUT);
check('doanh_so_non: numerator = Dso Non', r.numerator === 0, r);
check(
  'doanh_so_non: cùng target quý và cùng kết luận',
  r.targetValue === 31500000000 && r.revenue.verdict === 'pass',
  r,
);
check('doanh_so_non: actualValue = tỷ lệ NON (0%)', r.actualValue === 0, r);

console.log('\n[R4] Kết luận theo % đạt so chỉ tiêu quý');
const belowTarget = {
  quarter: Q3,
  quarterTarget: 31500000000,
  customers: [
    { customerId: 1, tier: 'KEY', quantity: 5, lineTotal: 1000000000 },
  ],
};
r = engine.scoreSale(KEY_DEF(), [], null, true, FROM_Q, belowTarget);
check(
  '3,2% so với chỉ tiêu → không đạt',
  r.status === 'fail' && r.revenue.achievedRatio === 0.0317,
  r,
);
const noTarget = {
  quarter: Q3,
  quarterTarget: null,
  customers: belowTarget.customers,
};
r = engine.scoreSale(KEY_DEF(), [], null, true, FROM_Q, noTarget);
check(
  'chưa có chỉ tiêu quý → no_data kèm lý do',
  r.status === 'no_data' && !!r.reason,
  r,
);
const notWholeQuarter = {
  quarter: null,
  quarterTarget: 31500000000,
  customers: belowTarget.customers,
};
r = engine.scoreSale(KEY_DEF(), [], null, true, '2026-10-05', notWholeQuarter);
check(
  'khoảng xem không trọn quý → không kết luận',
  r.status === 'ratio' && r.revenue.verdict === null,
  r,
);
check('vẫn báo doanh thu thực của khoảng', r.numerator === 1000000000, r);
check(
  'không tính % đạt khi không trọn quý',
  r.revenue.achievedRatio === null && r.revenue.achievedPct === null,
  r,
);

console.log('\n[R5] Lớp tổng hợp theo loại khách (§5.3)');
const mixNon = { quarter: Q3, quarterTarget: 1000000000, customers: [] };
r = engine.scoreSale(KEY_DEF(), [], null, true, FROM_Q, mixNon);
check(
  'sale không có khách → no_data',
  r.status === 'no_data' && r.reason === REASON_NO_CUSTOMERS,
  r,
);

const criteriaOf = (list) => list.map((c) => c);
const keyAllPass = [
  {
    key: 'doanh_so_key',
    scoringMode: 'ratio',
    status: 'pass',
    actualValue: 1,
    targetValue: null,
    tierScope: 'KEY',
  },
  {
    key: 'doanh_so_non',
    scoringMode: 'ratio',
    status: 'no_data',
    actualValue: null,
    targetValue: null,
    tierScope: 'NON',
    notApplicable: true,
  },
  {
    key: 'support_khach',
    scoringMode: 'binary',
    status: 'pass',
    actualValue: 1,
    targetValue: 1,
  },
  {
    key: 'lien_lac_phan_hoi',
    scoringMode: 'binary',
    status: 'pass',
    actualValue: 1,
    targetValue: 1,
  },
  {
    key: 'goi_y_thuc_hien',
    scoringMode: 'binary',
    status: 'pass',
    actualValue: 1,
    targetValue: 1,
  },
];
let t = engine.summarizeCustomerByTier(criteriaOf(keyAllPass), 'KEY');
check(
  'KEY đạt cả 4 → đạt',
  t.verdict === 'pass' && t.applicable === 4 && t.passed === 4,
  t,
);
const keyMissOne = criteriaOf(keyAllPass).map((c, i) =>
  i === 3 ? { ...c, status: 'fail' } : c,
);
t = engine.summarizeCustomerByTier(keyMissOne, 'KEY');
check(
  'KEY trượt 1 tiêu chí → không đạt (nghiêm ngặt)',
  t.verdict === 'fail' && t.passed === 3,
  t,
);
// Khách NON đổi chiều: doanh_so_non chấm được, doanh_so_key là cột loại khác
const nonCriteria = keyAllPass.map((c, i) => {
  if (i === 0) {
    return { ...c, tierScope: 'KEY', notApplicable: true, status: 'no_data' };
  }
  if (i === 1) {
    return { ...c, tierScope: 'NON', notApplicable: false, status: 'pass' };
  }
  if (i === 3) return { ...c, status: 'fail' };
  return c;
});
t = engine.summarizeCustomerByTier(criteriaOf(nonCriteria), 'NON');
check(
  'NON đếm x/4 tiêu chí, không kết luận',
  t.verdict === null && t.applicable === 4 && t.passed === 3,
  t,
);
t = engine.summarizeCustomerByTier(
  criteriaOf(nonCriteria).map((c) => ({ ...c, status: 'pass' })),
  'NON',
);
check(
  'NON đạt 4/4 vẫn không ra kết luận đạt/trượt',
  t.verdict === null && t.passed === 4,
  t,
);


// ─── Cộng dồn phân phối (nhóm / công ty) + cắt nhãn nhân viên ───
const rev = (tier, quantity, lineTotal, customerId = 1) => ({ tier, quantity, lineTotal, customerId });

console.log('\n[R6] rollupRevenue — cộng dồn sale → nhóm → công ty (cùng cách cộng ở cả 3 cấp)');
let roll = rollupRevenue([
  rev('KEY', 5, 100000, 1),
  rev('KEY', 0, 0, 2),
  rev('KEY', 3, 50000, 3),
  rev('NON', 0, 0, 4),
  rev('NON', 7, 25000, 5),
]);
check('Dso Key = 150.000', roll.dsoKey === 150000, roll);
check('Dso Non = 25.000', roll.dsoNon === 25000, roll);
check('tỷ lệ DS Key = 150/175 → 0,8571', roll.keyShareRatio === 0.8571, roll);
check('% DS Key = 85,71', roll.keySharePct === 85.71, roll);
check('% DS Non = 14,29', roll.nonSharePct === 14.29, roll);
check('Key: 2/3 khách có phát sinh', roll.keyCustomers.reached === 2 && roll.keyCustomers.total === 3, roll);
check('Non: 1/2 khách có phát sinh', roll.nonCustomers.reached === 1 && roll.nonCustomers.total === 2, roll);

roll = rollupRevenue([rev('KEY', 1, 100)]);
check('chỉ có khách KEY → tỷ lệ 1, Dso Non 0', roll.keyShareRatio === 1 && roll.dsoNon === 0, roll);
roll = rollupRevenue([rev('NON', 1, 100)]);
check('chỉ có khách NON → tỷ lệ 0', roll.keyShareRatio === 0, roll);
roll = rollupRevenue([rev('KEY', 0, 0), rev('NON', 0, 0)]);
check(
  'chưa ai bán gì → tỷ lệ NULL (không phải NaN/0 gây hiểu nhầm)',
  roll.keyShareRatio === null && roll.keySharePct === null,
  roll,
);
roll = rollupRevenue([rev(null, 4, 9999)]);
check(
  'khách chưa xác định KEY/NON → không vào cột nào nhưng cũng không sai số',
  roll.dsoKey === 0 && roll.dsoNon === 0 && roll.keyCustomers.total === 0,
  roll,
);
roll = rollupRevenue([]);
check('rỗng → toàn 0, tỷ lệ null', roll.dsoKey === 0 && roll.keyShareRatio === null, roll);
// Làm tròn: 1/3 = 0,3333 (4 chữ số)
roll = rollupRevenue([rev('KEY', 1, 1), rev('NON', 2, 2)]);
check('1/3 làmm tròn 4 chữ số → 0,3333', roll.keyShareRatio === 0.3333, roll);
// Cộng 2 nhóm phải bằng cộng 1 lượt (tính chất cộng được)
const a = rollupRevenue([rev('KEY', 2, 700), rev('NON', 1, 300)]);
const b = rollupRevenue([rev('KEY', 1, 400)]);
const c = rollupRevenue([rev('NON', 1, 300), rev('KEY', 1, 300)]);
check(
  'gộp 2 nhóm = gộp 1 lượt (không trùng, không mất)',
  a.dsoKey + a.dsoNon === b.dsoKey + b.dsoNon + c.dsoKey + c.dsoNon,
  { a, b, c },
);

console.log('\n[R7] Cắt nhãn nhân viên — lấy mã trước dấu gạch ĐẦU TIÊN');
const eqStr = (name, actual, expected) => check(name, actual === expected, { actual, expected });
eqStr('NKDS33-NGUYỄN CHÍ ĐẠO → NKDS33', employeeCodeOfLabel('NKDS33-NGUYỄN CHÍ ĐẠO'), 'NKDS33');
eqStr('NKDS12-ĐÀO-CẨM TÚ (nhiều dấu gạch) → NKDS12', employeeCodeOfLabel('NKDS12-ĐÀO-CẨM TÚ'), 'NKDS12');
eqStr('chữ thường + khoảng trắng → viết hoa', employeeCodeOfLabel('  nkds07-a b  '), 'NKDS07');
eqStr('không có dấu gạch → cả nhãn là mã', employeeCodeOfLabel('NKDS33'), 'NKDS33');
eqStr('nhãn rỗng → rỗng', employeeCodeOfLabel(''), '');
eqStr('tên: NKDS12-ĐÀO CẨM TÚ → ĐÀO CẨM TÚ', saleNameOfLabel('NKDS12-ĐÀO CẨM TÚ'), 'ĐÀO CẨM TÚ');
eqStr('tên giữ nguyên dấu gạch trong họ tên', saleNameOfLabel('NKDS12-ĐÀO-CẨM TÚ'), 'ĐÀO-CẨM TÚ');
eqStr('tên: không có dấu gạch → null', saleNameOfLabel('NKDS33'), null);
eqStr('tên: nhãn rỗng → null', saleNameOfLabel(''), null);
check(
  'mã + tên ghép lại đúng nhãn gốc',
  `${employeeCodeOfLabel('NKDS33-NGUYỄN CHÍ ĐẠO')}-${saleNameOfLabel('NKDS33-NGUYỄN CHÍ ĐẠO')}` === 'NKDS33-NGUYỄN CHÍ ĐẠO',
);

console.log(
  '\n[S] Tiêu chí 6 — open_order_suggestion (đơn chưa chốt 4 ngày gần nhất)',
);
const suggestDef = (o = {}) =>
  def({
    key: 'goi_y_don_hang',
    metric: ORDER_SUGGESTION_METRIC,
    scoring_mode: 'binary',
    comparison: 'gte',
    target_value: 1,
    period: 'day',
    ...o,
  });
const OPEN = { count: 3, totalValue: 99800000, latestOrderDate: '2026-10-15' };
const LINKED_DAY = { ...day('2026-10-15') };

r = engine.scoreCustomer(suggestDef(), [LINKED_DAY], 1, FROM, null, undefined, OPEN);
check(
  'khách có đơn chưa chốt → pass, actualValue = số gợi ý',
  r.status === 'pass' && r.actualValue === 3,
  r,
);
check(
  'trả kèm số gợi ý + tổng giá trị + ngày đơn gần nhất',
  r.openOrderCount === 3 &&
    r.openOrderValue === 99800000 &&
    r.openOrderDate === '2026-10-15',
  r,
);

r = engine.scoreCustomer(suggestDef(), [LINKED_DAY], 1, FROM, null, undefined, null);
check(
  'khách không có đơn chưa chốt → fail (KHÔNG phải no_data)',
  r.status === 'fail' && r.actualValue === 0 && r.openOrderValue === 0,
  r,
);

r = engine.scoreCustomer(
  suggestDef({ comparison: 'lte', target_value: 0 }),
  [LINKED_DAY],
  0,
  FROM,
  null,
  undefined,
  null,
);
check(
  'đổi comparison sang lte + target 0 → đạt khi hết đơn tồn',
  r.status === 'pass',
  r,
);

r = engine.scoreCustomer(
  suggestDef(),
  [{ ...day('2026-10-15', { linked: false }) }],
  1,
  FROM,
  null,
  undefined,
  OPEN,
);
check(
  'đơn ở DB chính nên không gate zalo_linked (khách chưa khớp vẫn chấm)',
  r.status === 'pass',
  r,
);

// Cấp sale: hai số lead cần — tổng số gợi ý và tổng giá trị
const saleSuggestion = {
  count: 5,
  totalValue: 168800000,
  latestOrderDate: '2026-10-15',
  orderCount: 3,
  customersWithOrders: 2,
  totalCustomers: 9,
  windowDays: ORDER_SUGGESTION_WINDOW_DAYS,
};
r = engine.scoreSale(
  suggestDef(),
  [custA, custB],
  null,
  true,
  FROM,
  undefined,
  saleSuggestion,
);
check('sale có đơn chưa chốt → pass', r.status === 'pass', r);
check(
  'numerator = TỔNG SỐ GỢI Ý, orderSuggestion giữ tổng giá trị',
  r.numerator === 5 && r.orderSuggestion?.totalValue === 168800000,
  r,
);
check(
  'x/y khách có đơn chưa chốt + cửa sổ 4 ngày',
  r.passedCriteria === 2 &&
    r.totalCriteria === 9 &&
    r.orderSuggestion?.windowDays === 4,
  r,
);

r = engine.scoreSale(
  suggestDef(),
  [custA, custB],
  null,
  true,
  FROM,
  undefined,
  {
    ...saleSuggestion,
    count: 0,
    totalValue: 0,
    orderCount: 0,
    customersWithOrders: 0,
  },
);
check(
  'sale không có đơn chưa chốt → fail, x = 0',
  r.status === 'fail' && r.numerator === 0,
  r,
);

r = engine.scoreSale(suggestDef(), [custA], null, true, FROM, undefined, undefined);
check(
  'chưa nạp dữ liệu đơn → no_data kèm lý do (không kết luận trượt)',
  r.status === 'no_data' && r.reason === REASON_NO_CUSTOMERS,
  r,
);

console.log(`
===== ${pass} pass, ${fail} fail =====`);
process.exit(fail === 0 ? 0 : 1);
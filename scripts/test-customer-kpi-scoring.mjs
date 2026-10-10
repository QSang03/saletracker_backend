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
  REASON_NO_REVENUE_SOURCE,
  REASON_NO_ZALO_LINK,
  REASON_SALE_OFFLINE,
  REASON_NO_CUSTOMERS,
} from '../dist/customer-kpi/customer-kpi-scoring.service.js';

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
    console.log('  FAIL-', name, extra !== undefined ? JSON.stringify(extra) : '');
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
const custA = { days: [day('2026-10-01', { ob: 3, ib: 1 }), day('2026-10-02', { ob: 1 })] };
const custB = {
  days: [day('2026-10-01', { linked: false }), day('2026-10-02', { linked: false })],
};
const FROM = '2026-10-01';

console.log('-- Engine chấm điểm KPI (unit) --');

console.log('\n[1] denominator reachable_customers (mặc định) — B bị loại khỏi mẫu số');
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
const custD = { days: [day('2026-10-01', { orders: 3 }), day('2026-10-02', { orders: 0 })] };
const custE = { days: [day('2026-10-01', { orders: 1 })] };
r = engine.scoreCustomer(
  def({ metric: 'order_count', scoring_mode: 'binary', comparison: 'gte', target_value: 2 }),
  custD.days,
  2,
  FROM,
);
check('A: 3 đơn >= 2 → pass', r.status === 'pass', r);
r = engine.scoreCustomer(
  def({ metric: 'order_count', scoring_mode: 'binary', comparison: 'gte', target_value: 2 }),
  custE.days,
  2,
  FROM,
);
check('B: 1 đơn < 2 → fail', r.status === 'fail', r);
check('actualValue = số đơn thật (1)', r.actualValue === 1, r);

console.log('\n[5] order_count binary lte — ít đơn hơn mới đạt');
r = engine.scoreCustomer(
  def({ metric: 'order_count', scoring_mode: 'binary', comparison: 'lte', target_value: 1 }),
  custE.days,
  1,
  FROM,
);
check('1 đơn <= 1 → pass', r.status === 'pass', r);
r = engine.scoreCustomer(
  def({ metric: 'order_count', scoring_mode: 'binary', comparison: 'lte', target_value: 1 }),
  custD.days,
  1,
  FROM,
);
check('3 đơn > 1 → fail', r.status === 'fail', r);

console.log('\n[6] order_count ratio target_value — % chỉ tiêu');
r = engine.scoreCustomer(
  def({ metric: 'order_count', scoring_mode: 'ratio', denominator: 'target_value' }),
  custD.days,
  5,
  FROM,
);
check('3/5 = 60%', r.actualValue === 60, r);
r = engine.scoreCustomer(
  def({ metric: 'order_count', scoring_mode: 'ratio', denominator: 'target_value' }),
  custE.days,
  null,
  FROM,
);
check('không có chỉ tiêu → no_data + reason', r.status === 'no_data' && !!r.reason, r);

console.log('\n[7] order_count ratio với mẫu số đếm khách → no_data cảnh báo cấu hình sai');
r = engine.scoreCustomer(
  def({ metric: 'order_count', scoring_mode: 'ratio', denominator: 'reachable_customers' }),
  custD.days,
  5,
  FROM,
);
check('no_data', r.status === 'no_data', r);
check('reason nói rõ mẫu số không áp dụng', /reachable_customers/.test(r.reason || ''), r);

console.log('\n[8] order_count binary không có ngưỡng → no_data');
r = engine.scoreCustomer(
  def({ metric: 'order_count', scoring_mode: 'binary', comparison: 'gte' }),
  custD.days,
  null,
  FROM,
);
check('no_data + reason', r.status === 'no_data' && /ngưỡng/.test(r.reason || ''), r);

console.log('\n[9] debt_balance');
r = engine.scoreCustomer(
  def({ metric: 'debt_balance', scoring_mode: 'binary', comparison: 'lte', target_value: 1000 }),
  custD.days,
  1000,
  FROM,
  500,
);
check('nợ 500 <= 1000 → pass', r.status === 'pass', r);
r = engine.scoreCustomer(
  def({ metric: 'debt_balance', scoring_mode: 'binary', comparison: 'lte', target_value: 1000 }),
  custD.days,
  1000,
  FROM,
  5000,
);
check('nợ 5000 > 1000 → fail', r.status === 'fail', r);
r = engine.scoreCustomer(
  def({ metric: 'debt_balance', scoring_mode: 'binary', comparison: 'lte', target_value: 1000 }),
  custD.days,
  1000,
  FROM,
  null,
);
check('không tra được nợ → no_data', r.status === 'no_data' && /công nợ/.test(r.reason || ''), r);
r = engine.scoreCustomer(
  def({ metric: 'debt_balance', scoring_mode: 'ratio', denominator: 'target_value' }),
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
  def({ metric: 'debt_balance', scoring_mode: 'ratio', denominator: 'target_value' }),
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
  def({ metric: 'order_count', scoring_mode: 'ratio', denominator: 'target_value' }),
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
r = engine.scoreCustomer(def({ metric: 'revenue_key', denominator: 'target_value' }), custD.days, 100, FROM);
check('revenue vẫn no_data chờ API', r.status === 'no_data' && r.reason === REASON_NO_REVENUE_SOURCE, r);
r = engine.scoreCustomer(
  def({ metric: 'suggestion_ack', scoring_mode: 'binary', target_value: 1 }),
  [day('2026-10-08', { ob: 1 }), ...Array.from({ length: 7 }, (_, i) => day(`2026-10-0${i + 1}`, { ob: 0 }))],
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
check('contacted cấp khách vẫn trả %', r.status === 'ratio' && r.actualValue === 50, r);
r = engine.scoreCustomer(
  def({ metric: 'responded_customers', denominator: 'reachable_customers' }),
  [day('2026-10-01', { ob: 2, ib: 1 }), day('2026-10-02', { ob: 0, ib: 5 })],
  null,
  FROM,
);
check('responded cấp khách: 1/2 ngày 2 chiều = 50%', r.status === 'ratio' && r.actualValue === 50, r);
r = engine.scoreSale(
  def({ metric: 'contacted_customers', denominator: 'all_customers' }),
  [],
  null,
  false,
  FROM,
);
check('all_customers + không có khách → no_data lý do riêng', r.status === 'no_data' && r.reason === REASON_NO_CUSTOMERS, r);

console.log(`\n===== ${pass} pass, ${fail} fail =====`);
process.exit(fail === 0 ? 0 : 1);

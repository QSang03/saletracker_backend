/**
 * Unit test bộ lọc + sắp xếp của hai endpoint báo cáo KPI:
 * - by-sale: bộ lọc/sắp xếp BẢNG KHÁCH HÀNG của một sale.
 * - overview: luật "đạt" cấp sale, tổng hợp `summary` và lọc danh sách sale
 *   theo tiêu chí.
 *
 * Chạy TRỰC TIẾP trên src qua ts-node — không cần build dist, không cần
 * server/DB nên an toàn khi server dev đang chạy:
 *
 *   npm run test:kpi-report-filter
 *
 * (cần `-r tsconfig-paths/register` vì service kéo theo User entity, entity
 * này import bằng path alias `src/*` của tsconfig).
 *
 * Phủ: lọc danh tính (tier/role/department/zaloStatus/sapCode/search), lọc
 * theo kết quả chấm (status/criterionKey/minRatio), lọc theo hoạt động
 * (đơn/doanh thu/tin nhắn/ngày chưa liên lạc), lọc công nợ, sắp xếp (cột cố
 * định + mã tiêu chí, null luôn xếp cuối), luật "đạt" + summary + lọc sale
 * của overview, và guard 400 của service.
 */
import {
  KpiReportCustomer,
  KpiFilterContext,
  KPI_SORT_KEYS,
  criterionMet,
  filterKpiCustomers,
  filterKpiSales,
  sortKpiCustomers,
  summarizeKpiSales,
} from '../src/customer-kpi/kpi-report-filter';
import { CustomerKpiReportsService } from '../src/customer-kpi/customer-kpi-reports.service';
import { SaleCriterion } from '../src/customer-kpi/customer-kpi-scoring.service';
import {
  KpiBySaleQueryDto,
  KpiOverviewQueryDto,
} from '../src/customer-kpi/dto/kpi-report-query.dto';
import {
  KpiDenominator,
  ScoringMode,
} from '../src/customer-kpi/kpi-definition.entity';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) {
    passed += 1;
    console.log('  ok  -', name);
  } else {
    failed += 1;
    console.log('  FAIL-', name, extra !== undefined ? JSON.stringify(extra) : '');
  }
};

// ---------------------------------------------------------------- fixtures

const DEBT: Record<string, number | null> = {};
const CONTACT: Record<string, number> = {};

interface RowInput {
  assignmentId: number;
  customerId: number;
  code: string;
  name?: string | null;
  tier?: 'KEY' | 'NON' | null;
  role?: 'CHINH' | 'PHU' | null;
  department?: string;
  sapCode?: string;
  zaloLinked?: boolean;
  inbound?: number;
  outbound?: number;
  orders?: number;
  revenue?: number;
  debt?: number | null;
  /** Số ngày chưa liên lạc; giữ MAX_SAFE_INTEGER = chưa có tin trong cửa sổ. */
  since?: number;
  criteria?: Record<string, { status: string; actualValue: number | null }>;
  /** Kết luận theo loại khách; mặc định 0 tiêu chí đạt / không áp dụng. */
  tierSummary?: { applicable: number; passed: number; verdict: 'pass' | 'fail' | null };
}

const CRITERIA = ['support_khach', 'lien_lac_phan_hoi', 'goi_y_thuc_hien'];
const NO_CONTACT = Number.MAX_SAFE_INTEGER;

const makeRow = (input: RowInput): KpiReportCustomer => ({
  row: {
    assignmentId: input.assignmentId,
    customerId: input.customerId,
    customerCode: input.code,
    customerName: input.name ?? null,
    customerTier: input.tier ?? null,
    customerRole: input.role ?? null,
    departmentSlug: input.department ?? 'may-in',
    sapCode: input.sapCode ?? '',
  },
  zaloLinked: input.zaloLinked ?? true,
  tierSummary: input.tierSummary ?? {
    tier: input.tier ?? null,
    applicable: 0,
    passed: 0,
    verdict: null,
  },
  criteria: (
    input.criteria
      ? Object.entries(input.criteria)
      : CRITERIA.map((key) => [key, { status: 'ratio', actualValue: 50 }])
  ).map(([key, value]) => ({
    key,
    scoringMode: 'ratio' as const,
    status: value.status as any,
    actualValue: value.actualValue,
    targetValue: null,
  })),
  totals: {
    inbound: input.inbound ?? 0,
    outbound: input.outbound ?? 0,
    orders: input.orders ?? 0,
    revenue: input.revenue ?? 0,
  },
});

const customer = (id: number, input: Omit<RowInput, 'assignmentId' | 'customerId'>) => {
  if (input.debt !== undefined) DEBT[id] = input.debt;
  if (input.since !== undefined) CONTACT[id] = input.since;
  return makeRow({ assignmentId: id, customerId: id, code: `CODE_${id}`, ...input });
};

const makeContext = (rows: KpiReportCustomer[]): KpiFilterContext => {
  const debtBalances = new Map<number, number | null>();
  const daysSinceContact = new Map<number, number>();
  for (const row of rows) {
    debtBalances.set(row.row.customerId, null);
    daysSinceContact.set(row.row.assignmentId, 0);
  }
  for (const [id, value] of Object.entries(DEBT)) {
    debtBalances.set(Number(id), value);
  }
  for (const [id, value] of Object.entries(CONTACT)) {
    daysSinceContact.set(Number(id), value);
  }
  return { debtBalances, daysSinceContact };
};

// ---------------------------------------------------------------- data

const keyAllPass = customer(1, {
  name: 'Khách Một',
  tier: 'KEY',
  role: 'CHINH',
  department: 'may-in',
  orders: 3,
  revenue: 1000,
  inbound: 10,
  outbound: 20,
  zaloLinked: true,
  sapCode: 'C100',
  criteria: {
    support_khach: { status: 'ratio', actualValue: 90 },
    lien_lac_phan_hoi: { status: 'ratio', actualValue: 80 },
    goi_y_thuc_hien: { status: 'pass', actualValue: 1 },
  },
  tierSummary: { applicable: 3, passed: 3, verdict: 'pass' },
  debt: 5000,
  since: 1,
});

const nonFailing = customer(2, {
  name: 'Khách Hai',
  tier: 'NON',
  role: 'PHU',
  department: 'laptop',
  orders: 0,
  revenue: 0,
  inbound: 2,
  outbound: 0,
  zaloLinked: false,
  sapCode: 'C200',
  criteria: {
    support_khach: { status: 'fail', actualValue: 0 },
    lien_lac_phan_hoi: { status: 'no_data', actualValue: null },
    goi_y_thuc_hien: { status: 'fail', actualValue: 0 },
  },
  tierSummary: { applicable: 3, passed: 0, verdict: null },
  debt: null, // không xác định được công nợ
  since: NO_CONTACT,
});

const keyNoData = customer(3, {
  name: 'Khách Ba',
  tier: 'KEY',
  role: 'PHU',
  department: 'may-in',
  orders: 1,
  revenue: 500,
  zaloLinked: true,
  sapCode: 'C300',
  criteria: {
    support_khach: { status: 'no_data', actualValue: null },
    lien_lac_phan_hoi: { status: 'ratio', actualValue: 60 },
    goi_y_thuc_hien: { status: 'fail', actualValue: 0 },
  },
  tierSummary: { applicable: 3, passed: 1, verdict: 'fail' },
  debt: 0,
  since: 10,
});

const ROWS = [keyAllPass, nonFailing, keyNoData];
const CTX = makeContext(ROWS);

// ids() = để lọc (không quan tâm thứ tự); order() = giữ nguyên thứ tự.
const ids = (rows: KpiReportCustomer[]) =>
  rows.map((r) => r.row.assignmentId).sort().join();
const order = (rows: KpiReportCustomer[]) =>
  rows.map((r) => r.row.assignmentId).join();

// ---------------------------------------------------------------- filters

console.log('-- lọc danh tính');
check('tier=KEY chỉ giữ khách KEY', ids(filterKpiCustomers(ROWS, { tier: 'KEY' }, CTX)) === '1,3');
check('tier=NON chỉ giữ khách NON', ids(filterKpiCustomers(ROWS, { tier: 'NON' }, CTX)) === '2');
check('role=PHU', ids(filterKpiCustomers(ROWS, { role: 'PHU' }, CTX)) === '2,3');
check('department=laptop', ids(filterKpiCustomers(ROWS, { department: 'laptop' }, CTX)) === '2');
check('zaloStatus=unlinked', ids(filterKpiCustomers(ROWS, { zaloStatus: 'unlinked' }, CTX)) === '2');
check('zaloStatus=linked', ids(filterKpiCustomers(ROWS, { zaloStatus: 'linked' }, CTX)) === '1,3');
check('sapCode khớp không phân biệt hoa thường', ids(filterKpiCustomers(ROWS, { sapCode: 'c200' }, CTX)) === '2');
check('search khớp mã', ids(filterKpiCustomers(ROWS, { search: 'code_3' }, CTX)) === '3');
check('search khớp tên', ids(filterKpiCustomers(ROWS, { search: 'khách một' }, CTX)) === '1');
check('search không khớp', filterKpiCustomers(ROWS, { search: 'xyz' }, CTX).length === 0);
check('khách không có tier bị loại khi lọc tier', filterKpiCustomers(ROWS, { tier: 'KEY' }, CTX).length === 2);

console.log('-- lọc theo kết quả chấm');
check(
  'criterionKey + status=fail',
  ids(filterKpiCustomers(ROWS, { criterionKey: 'support_khach', status: 'fail' }, CTX)) === '2',
);
check(
  'status=pass một mình = có ít nhất một tiêu chí đạt',
  ids(filterKpiCustomers(ROWS, { status: 'pass' }, CTX)) === '1',
);
check(
  'status=no_data một mình = có ít nhất một tiêu chí thiếu dữ liệu',
  ids(filterKpiCustomers(ROWS, { status: 'no_data' }, CTX)) === '2,3',
);
check(
  'criterionKey không tồn tại → không khớp ai',
  ids(filterKpiCustomers(ROWS, { criterionKey: 'khong_co', status: 'fail' }, CTX)) === '',
);
check(
  'minRatio + criterionKey',
  ids(filterKpiCustomers(ROWS, { criterionKey: 'support_khach', minRatio: 85 }, CTX)) === '1',
);
check(
  'minRatio một mình = có ít nhất một tiêu chí ≥ ngưỡng',
  ids(filterKpiCustomers(ROWS, { minRatio: 80 }, CTX)) === '1',
);

console.log('-- lọc theo hoạt động');
check('hasOrders=true', ids(filterKpiCustomers(ROWS, { hasOrders: true }, CTX)) === '1,3');
check('hasOrders=false', ids(filterKpiCustomers(ROWS, { hasOrders: false }, CTX)) === '2');
check('minOrders=2', ids(filterKpiCustomers(ROWS, { minOrders: 2 }, CTX)) === '1');
check('minRevenue=600', ids(filterKpiCustomers(ROWS, { minRevenue: 600 }, CTX)) === '1');
check('minInbound=5', ids(filterKpiCustomers(ROWS, { minInbound: 5 }, CTX)) === '1');
check('minOutbound=10', ids(filterKpiCustomers(ROWS, { minOutbound: 10 }, CTX)) === '1');
check(
  'daysSinceContact≥7 — khách KHÔNG có tin trong cửa sổ coi như bỏ bê lâu nhất',
  ids(filterKpiCustomers(ROWS, { daysSinceContact: 7 }, CTX)) === '2,3',
);
check(
  'daysSinceContact≥1',
  ids(filterKpiCustomers(ROWS, { daysSinceContact: 1 }, CTX)) === '1,2,3',
);
check(
  'daysSinceContact≥20 chỉ còn khách chưa có tin trong cửa sổ',
  ids(filterKpiCustomers(ROWS, { daysSinceContact: 20 }, CTX)) === '2',
);

console.log('-- lọc công nợ');
check('hasDebt=true chỉ giữ khách còn nợ', ids(filterKpiCustomers(ROWS, { hasDebt: true }, CTX)) === '1');
check('hasDebt=false = xác định được và không còn nợ', ids(filterKpiCustomers(ROWS, { hasDebt: false }, CTX)) === '3');
check('minDebt=1000', ids(filterKpiCustomers(ROWS, { minDebt: 1000 }, CTX)) === '1');
check(
  'khách không xác định được công nợ bị loại khỏi mọi lọc công nợ',
  filterKpiCustomers(ROWS, { hasDebt: false }, CTX).every((r) => r.row.customerId !== 2),
);

console.log('-- AND giữa các nhóm lọc');
check(
  'tier=KEY + status=no_data + hasOrders=true',
  ids(filterKpiCustomers(ROWS, { tier: 'KEY', status: 'no_data', hasOrders: true }, CTX)) === '3',
);

console.log('-- sắp xếp');
check('không sortBy giữ nguyên thứ tự', sortKpiCustomers(ROWS, undefined, undefined, CTX) === ROWS);
check('sortBy=revenue desc', order(sortKpiCustomers(ROWS, 'revenue', 'desc', CTX)) === '1,3,2');
check('sortBy=revenue asc', order(sortKpiCustomers(ROWS, 'revenue', 'asc', CTX)) === '2,3,1');
check('sortBy=tier đứng KEY trước NON', order(sortKpiCustomers(ROWS, 'tier', 'asc', CTX)) === '1,3,2');
check('sortBy=tierSummary desc đưa khách đạt nhiều tiêu chí lên đầu', order(sortKpiCustomers(ROWS, 'tierSummary', 'desc', CTX)) === '1,3,2');
check('sortBy=tierSummary asc', order(sortKpiCustomers(ROWS, 'tierSummary', 'asc', CTX)) === '2,3,1');
check(
  'sortBy=tierSummary applicable=0 (không có tiêu chí) vẫn xếp cuối khi desc',
  order(
    sortKpiCustomers(
      [
        ROWS[1],
        {
          ...ROWS[0],
          tierSummary: { tier: 'KEY', applicable: 0, passed: 0, verdict: null },
        },
        ROWS[2],
      ],
      'tierSummary',
      'desc',
      CTX,
    ),
  ) === '3,2,1',
);
check('sortBy=mã tiêu chí, no_data rơi xuống cuối', order(sortKpiCustomers(ROWS, 'support_khach', 'desc', CTX)) === '1,2,3');
check('sortBy=mã tiêu chí asc vẫn đẩy no_data xuống cuối', order(sortKpiCustomers(ROWS, 'lien_lac_phan_hoi', 'asc', CTX)) === '3,1,2');
check('sortBy=daysSinceContact desc đưa khách chưa liên lạc lên đầu', order(sortKpiCustomers(ROWS, 'daysSinceContact', 'desc', CTX)) === '2,3,1');
check('sortBy=debtBalance null xếp cuối', order(sortKpiCustomers(ROWS, 'debtBalance', 'desc', CTX)) === '1,3,2');
check('KPI_SORT_KEYS có đủ cột mong đợi', KPI_SORT_KEYS.length === 12);

// ------------------------------------------------------- overview (cấp sale)

/** Dựng một tiêu chí cấp sale với các field mặc định của SaleCriterion. */
const saleCriterion = (
  input: Partial<SaleCriterion> & Pick<SaleCriterion, 'key'>,
): SaleCriterion => ({
  name: input.key,
  scoringMode: ScoringMode.BINARY,
  denominator: null,
  status: 'no_data',
  actualValue: null,
  numerator: null,
  denominatorValue: null,
  targetValue: null,
  totalCriteria: null,
  passedCriteria: null,
  ...input,
});

interface SaleInput {
  saleId: number;
  saleName: string;
  zaloLinked?: boolean;
  criteria: SaleCriterion[];
}

const makeSale = (input: SaleInput) => ({
  saleId: input.saleId,
  saleName: input.saleName,
  zaloLinked: input.zaloLinked ?? true,
  criteria: input.criteria,
});

const SALE_A = makeSale({
  saleId: 2,
  saleName: 'Đỗ Minh Hùng',
  criteria: [
    saleCriterion({
      key: 'doanh_so_key',
      name: 'Doanh số theo Key',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.TARGET_VALUE,
      status: 'no_data', // chưa có nguồn doanh thu
    }),
    saleCriterion({
      key: 'support_khach',
      name: 'Support Khách / Thăm hỏi',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.REACHABLE_CUSTOMERS,
      status: 'ratio',
      actualValue: 62.5,
      targetValue: 100,
    }),
    saleCriterion({
      key: 'goi_y_thuc_hien',
      name: 'Gợi ý thực hiện',
      status: 'pass',
      actualValue: 1,
      targetValue: 1,
    }),
  ],
});

const SALE_B = makeSale({
  saleId: 3,
  saleName: 'Phạm Thị Tùng',
  zaloLinked: false, // sale offline → toàn bộ tiêu chí Zalo thiếu dữ liệu
  criteria: [
    saleCriterion({
      key: 'doanh_so_key',
      name: 'Doanh số theo Key',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.TARGET_VALUE,
      status: 'no_data',
    }),
    saleCriterion({
      key: 'support_khach',
      name: 'Support Khách / Thăm hỏi',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.REACHABLE_CUSTOMERS,
      status: 'no_data',
    }),
    saleCriterion({ key: 'goi_y_thuc_hien', name: 'Gợi ý thực hiện', status: 'no_data' }),
  ],
});

const SALE_C = makeSale({
  saleId: 5,
  saleName: 'Nguyễn Văn An',
  criteria: [
    saleCriterion({
      key: 'doanh_so_key',
      name: 'Doanh số theo Key',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.TARGET_VALUE,
      status: 'ratio',
      actualValue: 80,
      targetValue: 1000000,
    }),
    saleCriterion({
      key: 'support_khach',
      name: 'Support Khách / Thăm hỏi',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.REACHABLE_CUSTOMERS,
      status: 'ratio',
      actualValue: 40,
      targetValue: 100,
    }),
    saleCriterion({
      key: 'goi_y_thuc_hien',
      name: 'Gợi ý thực hiện',
      status: 'fail',
      actualValue: 0,
      targetValue: 1,
    }),
  ],
});

const SALE_D = makeSale({
  saleId: 7,
  saleName: 'Trần Thị Bình',
  criteria: [
    saleCriterion({
      key: 'doanh_so_key',
      name: 'Doanh số theo Key',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.TARGET_VALUE,
      status: 'ratio',
      actualValue: 120,
      targetValue: 1000000,
    }),
    saleCriterion({
      key: 'support_khach',
      name: 'Support Khách / Thăm hỏi',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.REACHABLE_CUSTOMERS,
      status: 'ratio',
      actualValue: 100,
      targetValue: 100,
    }),
    saleCriterion({
      key: 'goi_y_thuc_hien',
      name: 'Gợi ý thực hiện',
      status: 'pass',
      actualValue: 1,
      targetValue: 1,
    }),
  ],
});

// targetValue cấu hình thấp hơn 100 → 80% vẫn tính là đạt ngưỡng đã cấu hình
const SALE_E = makeSale({
  saleId: 9,
  saleName: 'Lê Văn Cường',
  criteria: [
    saleCriterion({
      key: 'doanh_so_key',
      name: 'Doanh số theo Key',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.TARGET_VALUE,
      status: 'ratio',
      actualValue: 30,
      targetValue: 1000000,
    }),
    saleCriterion({
      key: 'support_khach',
      name: 'Support Khách / Thăm hỏi',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.REACHABLE_CUSTOMERS,
      status: 'ratio',
      actualValue: 80,
      targetValue: 80,
    }),
    saleCriterion({
      key: 'goi_y_thuc_hien',
      name: 'Gợi ý thực hiện',
      status: 'fail',
      actualValue: 0,
      targetValue: 1,
    }),
  ],
});

const SALES = [SALE_A, SALE_B, SALE_C, SALE_D, SALE_E];
const saleIds = (sales: { saleId: number }[]) =>
  sales
    .map((s) => s.saleId)
    .sort()
    .join();
const summaryOf = (key: string) =>
  summarizeKpiSales(SALES.map((s) => s.criteria)).find((s) => s.key === key);

console.log('-- overview: luật "đạt" của một tiêu chí cấp sale');
check(
  'binary pass → đạt',
  criterionMet(saleCriterion({ key: 'goi_y_thuc_hien', status: 'pass' })) === true,
);
check(
  'binary fail → không đạt',
  criterionMet(saleCriterion({ key: 'goi_y_thuc_hien', status: 'fail' })) === false,
);
check(
  'thiếu dữ liệu → null (không kết luận được)',
  criterionMet(saleCriterion({ key: 'goi_y_thuc_hien', status: 'no_data' })) === null,
);
check(
  'ratio mẫu số đếm khách: đạt khi actualValue = 100',
  criterionMet(
    saleCriterion({
      key: 'support_khach',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.REACHABLE_CUSTOMERS,
      status: 'ratio',
      actualValue: 100,
      targetValue: 100,
    }),
  ) === true,
);
check(
  'ratio mẫu số đếm khách: targetValue cấu hình 80 thì 80% là đạt',
  criterionMet(
    saleCriterion({
      key: 'support_khach',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.REACHABLE_CUSTOMERS,
      status: 'ratio',
      actualValue: 80,
      targetValue: 80,
    }),
  ) === true,
);
check(
  'ratio mẫu số target_value: đạt khi vượt 100% chỉ tiêu',
  criterionMet(
    saleCriterion({
      key: 'doanh_so_key',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.TARGET_VALUE,
      status: 'ratio',
      actualValue: 120,
      targetValue: 1000000,
    }),
  ) === true,
);
check(
  'ratio mẫu số target_value: 80% CHỈ TIÊU TUYỆT ĐỐI không bị coi là đạt',
  criterionMet(
    saleCriterion({
      key: 'doanh_so_key',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.TARGET_VALUE,
      status: 'ratio',
      actualValue: 80,
      targetValue: 1000000,
    }),
  ) === false,
);
check(
  'ratio targetValue null → mặc định mốc 100',
  criterionMet(
    saleCriterion({
      key: 'support_khach',
      scoringMode: ScoringMode.RATIO,
      denominator: KpiDenominator.REACHABLE_CUSTOMERS,
      status: 'ratio',
      actualValue: 100,
    }),
  ) === true,
);

console.log('-- overview: summary đếm sale đạt/không đạt');
const SUM = summarizeKpiSales(SALES.map((s) => s.criteria));
check('một dòng mỗi tiêu chí, giữ thứ tự sale đầu tiên', SUM.map((s) => s.key).join() === 'doanh_so_key,support_khach,goi_y_thuc_hien');

const metSummary = summaryOf('goi_y_thuc_hien')!;
check('binary: 2 sale đạt', metSummary.metSales === 2, metSummary);
check('binary: 2 sale không đạt', metSummary.notMetSales === 2, metSummary);
check('binary: 1 sale thiếu dữ liệu', metSummary.noDataSales === 1, metSummary);
check('binary: total = đạt + không đạt + thiếu dữ liệu', metSummary.totalSales === 5, metSummary);
check('binary: không có avgActualValue', metSummary.avgActualValue === null, metSummary);

const supportSummary = summaryOf('support_khach')!;
check('ratio: sale offline bị đếm riêng, không rơi vào "không đạt"', supportSummary.noDataSales === 1, supportSummary);
check('ratio: đếm đúng 2 đạt / 2 không đạt', supportSummary.metSales === 2 && supportSummary.notMetSales === 2, supportSummary);
check('ratio: avgActualValue = trung bình các sale CÓ dữ liệu', supportSummary.avgActualValue === 70.6, supportSummary);

const revenueSummary = summaryOf('doanh_so_key')!;
check('ratio target_value: chỉ 1 sale đạt chỉ tiêu', revenueSummary.metSales === 1, revenueSummary);
check('ratio target_value: avg bỏ qua sale no_data', revenueSummary.avgActualValue === 76.7, revenueSummary);
check('summary rỗng khi không có sale', summarizeKpiSales([]).length === 0);

console.log('-- overview: lọc danh sách sale theo tiêu chí');
check('không filter → giữ nguyên cả danh sách', filterKpiSales(SALES, {}) === SALES);
check(
  'met=true chỉ giữ sale đạt tiêu chí đó',
  saleIds(filterKpiSales(SALES, { criterionKey: 'goi_y_thuc_hien', met: true })) === '2,7',
);
check(
  'met=false bỏ qua sale thiếu dữ liệu',
  saleIds(filterKpiSales(SALES, { criterionKey: 'goi_y_thuc_hien', met: false })) === '5,9',
);
check(
  'minRatio ngưỡng trên actualValue',
  saleIds(filterKpiSales(SALES, { criterionKey: 'support_khach', minRatio: 80 })) === '7,9',
);
check(
  'status=no_data liệt kê sale thiếu dữ liệu của tiêu chí',
  saleIds(filterKpiSales(SALES, { criterionKey: 'doanh_so_key', status: 'no_data' })) === '2,3',
);
check(
  'status một mình = sale có BẤT KỲ tiêu chí nào ở trạng thái đó',
  saleIds(filterKpiSales(SALES, { status: 'pass' })) === '2,7',
);
check(
  'minRatio một mình = sale có bất kỳ tiêu chí nào đạt ngưỡng',
  saleIds(filterKpiSales(SALES, { minRatio: 100 })) === '7',
);
check(
  'criterionKey không tồn tại → không khớp sale nào',
  filterKpiSales(SALES, { criterionKey: 'khong_co', met: true }).length === 0,
);
check(
  'AND giữa met và minRatio',
  saleIds(filterKpiSales(SALES, { criterionKey: 'support_khach', met: true, minRatio: 90 })) === '7',
);

console.log('-- guard của service (parseCustomerFilters / assert)');
const svc = new (CustomerKpiReportsService as any)();

const parsed = svc.parseCustomerFilters({
  tier: ' KEY ',
  hasOrders: 'true',
  minRatio: '80',
  page: '3',
  search: '   ',
  sortOrder: 'desc',
});
check('ép tier về chuỗi đã trim', parsed.tier === 'KEY');
check('ép hasOrders "true" → boolean', parsed.hasOrders === true);
check('ép minRatio "80" → number', parsed.minRatio === 80);
check('chuỗi rỗng → undefined', parsed.search === undefined);
check('sortOrder hợp lệ được giữ', parsed.sortOrder === 'desc');
check(
  'sortOrder lạ → undefined',
  svc.parseCustomerFilters({ sortOrder: 'sideways' }).sortOrder === undefined,
);

let error: any = null;
try {
  svc.assertCriterionFilters({ criterionKey: 'khong_co', status: 'fail' }, ['support_khach']);
} catch (e) {
  error = e;
}
check('criterionKey sai → BadRequest', error?.status === 400);

error = null;
try {
  svc.assertCriterionFilters({ criterionKey: 'support_khach' }, ['support_khach']);
} catch (e) {
  error = e;
}
check('criterionKey không kèm status/minRatio → BadRequest', error?.status === 400);

error = null;
svc.assertCriterionFilters({ criterionKey: 'support_khach', status: 'fail' }, ['support_khach']);
check('criterionKey hợp lệ + status → không ném', error === null);

error = null;
try {
  svc.assertSortKey('cot-la', ['support_khach']);
} catch (e) {
  error = e;
}
check('sortBy lạ → BadRequest', error?.status === 400);

error = null;
svc.assertSortKey('support_khach', ['support_khach']);
check('sortBy = mã tiêu chí đang bật → không ném', error === null);

// ------------------------------------------------- overview: guard + parse

const DEFINITIONS = [
  {
    key: 'doanh_so_key',
    scoring_mode: ScoringMode.RATIO,
    denominator: KpiDenominator.TARGET_VALUE,
  },
  {
    key: 'support_khach',
    scoring_mode: ScoringMode.RATIO,
    denominator: KpiDenominator.REACHABLE_CUSTOMERS,
  },
  {
    key: 'goi_y_thuc_hien',
    scoring_mode: ScoringMode.BINARY,
    denominator: null,
  },
] as any[];

const parsedOverview = svc.parseOverviewFilters({
  criterionKey: ' support_khach ',
  met: 'false',
  minRatio: '80',
  status: 'no_data',
  search: '   ',
});
check('parseOverviewFilters: trim criterionKey', parsedOverview.criterionKey === 'support_khach');
check('parseOverviewFilters: ép met về boolean', parsedOverview.met === false);
check('parseOverviewFilters: minRatio "80" → 80', parsedOverview.minRatio === 80);
check('parseOverviewFilters: status giữ nguyên chuỗi enum', parsedOverview.status === 'no_data');
check('parseOverviewFilters: không đọc lạc field của bảng khách (search)', parsedOverview.search === undefined);
check(
  'parseOverviewFilters: met rỗng → undefined',
  svc.parseOverviewFilters({ met: 'co' }).met === undefined,
);

const expect400 = (fn: () => void, name: string) => {
  let err: any = null;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  check(name, err?.status === 400, err);
};

expect400(
  () => svc.assertOverviewFilters({ criterionKey: 'khong_co', met: true }, DEFINITIONS),
  'overview: criterionKey sai → BadRequest',
);
expect400(
  () => svc.assertOverviewFilters({ criterionKey: 'support_khach' }, DEFINITIONS),
  'overview: criterionKey không kèm met/minRatio/status → BadRequest',
);
expect400(
  () => svc.assertOverviewFilters({ met: true }, DEFINITIONS),
  'overview: met không kèm criterionKey → BadRequest',
);
expect400(
  () => svc.assertOverviewFilters({ criterionKey: 'support_khach', status: 'pass' }, DEFINITIONS),
  'overview: tiêu chí ratio mà xin pass/fail → BadRequest',
);
expect400(
  () => svc.assertOverviewFilters({ status: 'ratio' }, DEFINITIONS),
  'overview: status=ratio không lọc được gì → BadRequest',
);
expect400(
  () =>
    svc.assertOverviewFilters(
      { status: 'fail' },
      [DEFINITIONS[0], DEFINITIONS[1]] as any[],
    ),
  'overview: status=pass/fail khi chỉ có tiêu chí ratio → BadRequest',
);

error = null;
svc.assertOverviewFilters({ criterionKey: 'goi_y_thuc_hien', status: 'pass' }, DEFINITIONS);
check('overview: tiêu chí binary + status=pass → không ném', error === null);
error = null;
svc.assertOverviewFilters({ criterionKey: 'doanh_so_key', minRatio: 50 }, DEFINITIONS);
check('overview: ratio + minRatio → không ném', error === null);
error = null;
svc.assertOverviewFilters({ criterionKey: 'doanh_so_key', status: 'no_data' }, DEFINITIONS);
check('overview: ratio + status=no_data → không ném (liệt kê sale thiếu dữ liệu)', error === null);
error = null;
svc.assertOverviewFilters({ status: 'fail' }, DEFINITIONS);
check('overview: status=pass/fail + có tiêu chí binary → không ném', error === null);
error = null;
check(
  'by-sale: parseCustomerFilters không bao giờ nhận met',
  !('met' in svc.parseCustomerFilters({ met: 'true' })),
);

// ValidationPipe toàn cục dùng whitelist + transform — chạy lại đúng luật đó
// cho DTO để chắc chắn rác từ query bị chặn trước khi vào service.
console.log('-- validate DTO (giả lập ValidationPipe của app)');
  const runDto = async () => {
    const dtoOf = async (query: Record<string, unknown>) => {
      const dto = plainToInstance(KpiBySaleQueryDto, query);
      const errors = await validate(dto);
      return { dto, errors };
    };
    const overviewOf = async (query: Record<string, unknown>) => {
      const dto = plainToInstance(KpiOverviewQueryDto, query);
      const errors = await validate(dto);
      return { dto, errors };
    };

  const ok = await dtoOf({
    saleId: '2',
    tier: 'KEY',
    role: 'PHU',
    department: 'may-in',
    zaloStatus: 'linked',
    criterionKey: 'support_khach',
    status: 'fail',
    minRatio: '75.5',
    hasOrders: 'true',
    minOrders: '1',
    minRevenue: '1000',
    minOutbound: '2',
    minInbound: '3',
    daysSinceContact: '7',
    minDebt: '5000',
    hasDebt: 'false',
    sortBy: 'revenue',
    sortOrder: 'desc',
    page: '2',
    pageSize: '50',
    from: '2026-10-01',
    to: '2026-10-07',
    search: 'HQC',
    sapCode: 'C100',
  });
  check('query hợp lệ → không lỗi validate', ok.errors.length === 0, ok.errors);
  check('transform: saleId thành number', ok.dto.saleId === 2);
  check('transform: minRatio thành number', ok.dto.minRatio === 75.5);
  check('transform: hasDebt giữ chuỗi true/false', ok.dto.hasDebt === 'false');
  check('transform: page/pageSize thành number', ok.dto.page === 2 && ok.dto.pageSize === 50);

  const badTier = await dtoOf({ saleId: 1, tier: 'VIP' });
  check('tier lạ → validate lỗi', badTier.errors.length > 0);

  const badRatio = await dtoOf({ saleId: 1, minRatio: 150 });
  check('minRatio > 100 → validate lỗi', badRatio.errors.length > 0);

  const badStatus = await dtoOf({ saleId: 1, status: 'maybe' });
  check('status lạ → validate lỗi', badStatus.errors.length > 0);

  const badPage = await dtoOf({ saleId: 1, page: 'abc' });
  check('page không phải số → validate lỗi', badPage.errors.length > 0);

  const badSort = await dtoOf({ saleId: 1, sortOrder: 'ngang' });
  check('sortOrder lạ → validate lỗi', badSort.errors.length > 0);

  const badBool = await dtoOf({ saleId: 1, hasOrders: 'co' });
  check('hasOrders lạ → validate lỗi', badBool.errors.length > 0);

  const empty = await dtoOf({});
  check('không truyền gì cũng không lỗi (dùng mặc định)', empty.errors.length === 0);
  check('không saleId → undefined (service sẽ ném 400)', empty.dto.saleId === undefined);

  // overview: criterionKey/met/minRatio/status — kế thừa nên by-sale cũng nhận
  const ov = await overviewOf({
    criterionKey: 'support_khach',
    met: 'true',
    minRatio: '75.5',
    status: 'no_data',
  });
  check('overview: query lọc tiêu chí hợp lệ', ov.errors.length === 0, ov.errors);
  check('overview: met giữ chuỗi true/false', ov.dto.met === 'true');
  check('overview: minRatio transform thành number', ov.dto.minRatio === 75.5);
  check('overview: by-sale vẫn nhận được met (service trả 400)', (await dtoOf({ met: 'true' })).errors.length === 0);

  const badMet = await overviewOf({ met: 'co' });
  check('met lạ → validate lỗi', badMet.errors.length > 0);
  const badOvRatio = await overviewOf({ minRatio: 120 });
  check('minRatio > 100 ở overview cũng lỗi', badOvRatio.errors.length > 0);
  const badOvStatus = await overviewOf({ status: 'tuong-duong' });
  check('status lạ ở overview → validate lỗi', badOvStatus.errors.length > 0);
};

runDto().then(() => {
  console.log(`\n${passed} pass, ${failed} fail`);
  process.exit(failed === 0 ? 0 : 1);
});

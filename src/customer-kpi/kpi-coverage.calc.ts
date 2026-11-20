import { KpiMonthlyStatus } from './kpi-monthly-result.entity';
import { KpiQuarterStatus } from './kpi-quarterly-settlement.entity';

/**
 * Công thức thuần cho độ phủ khách KEY và quyết toán quý.
 *
 * Tách khỏi service để test được bằng dữ liệu giả (scripts/test-kpi-coverage.ts)
 * mà không cần DB. Service chỉ lo nạp dữ liệu, gọi hàm ở đây và ghi snapshot.
 */

export interface CoverageAssignment {
  saleId: number;
  customerCode: string;
  /** KEY | NON (so sánh không phân biệt hoa thường). */
  tier: string | null;
  /**
   * id nhóm khách gộp (MẸ id) — CON cùng nhóm được cover khi có thành viên
   * CÙNG TIER phát sinh. Bỏ trống (test cũ/dữ liệu cũ) → mỗi mã là một nhóm.
   */
  groupId?: number | string | null;
}

export interface CoverageRevenueRow {
  slpCode: number;
  customerCode: string;
  quantity: number;
  lineTotal: number;
}

export interface SaleSlpMapping {
  saleId: number;
  /** Các slp_code của sale; rỗng = chưa map được mã NKM. */
  slpCodes: number[];
}

export interface MonthlyCoverageResult {
  saleId: number;
  nKey: number;
  coveredKey: number;
  coverageRate: number;
  status: KpiMonthlyStatus;
  /** Danh sách customer_code KEY — dùng cho snapshot/đối soát. */
  keyCodes: string[];
  coveredCodes: string[];
  /** Có map được slpCode không; false => PENDING. */
  hasMapping: boolean;
}

export interface QuarterTargetInput {
  saleId: number;
  targetValue: number;
  /** `sale_revenue_target.actual_value` — số S1 tự tính. */
  actualValue: number;
  hasTarget: boolean;
}

export interface QuarterSettlementResult {
  saleId: number;
  nKey: number;
  coveredKey: number;
  keyCoverageRate: number;
  targetValue: number;
  actualRevenue: number;
  /** `s1_quarter_api` | `daily_fallback` | `missing_mapping` | `missing_target` */
  revenueSource: string;
  revenueAchieved: boolean;
  keyAchieved: boolean;
  status: KpiQuarterStatus;
  keyCodes: string[];
  coveredCodes: string[];
}

const normalizeCode = (value: string | null | undefined): string =>
  String(value ?? '').trim();

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

/** Gom doanh thu theo slpCode -> customerCode; quantity > 0 mới tính là có phát sinh. */
function buildRevenueIndex(
  rows: CoverageRevenueRow[],
): Map<number, Map<string, { quantity: number; lineTotal: number }>> {
  const index = new Map<
    number,
    Map<string, { quantity: number; lineTotal: number }>
  >();
  for (const row of rows) {
    const code = normalizeCode(row.customerCode);
    if (!code) continue;
    const byCustomer =
      index.get(row.slpCode) ??
      new Map<string, { quantity: number; lineTotal: number }>();
    const current = byCustomer.get(code) ?? { quantity: 0, lineTotal: 0 };
    current.quantity += Number(row.quantity) || 0;
    current.lineTotal += Number(row.lineTotal) || 0;
    byCustomer.set(code, current);
    index.set(row.slpCode, byCustomer);
  }
  return index;
}

/**
 * Khoá nhóm để gộp độ phủ. Có groupId (khách gộp) thì dùng groupId; dữ liệu
 * cũ/test không có groupId thì mỗi mã là một nhóm riêng — giữ nguyên hành vi.
 */
const coverageGroupKey = (row: CoverageAssignment): string =>
  row.groupId != null
    ? `g:${String(row.groupId)}`
    : `c:${normalizeCode(row.customerCode)}`;

/** Gom assignment theo sale để không quét lại toàn bộ cho từng mapping. */
function indexAssignmentsBySale(
  assignments: CoverageAssignment[],
): Map<number, CoverageAssignment[]> {
  const bySale = new Map<number, CoverageAssignment[]>();
  for (const row of assignments) {
    const list = bySale.get(row.saleId) ?? [];
    list.push(row);
    bySale.set(row.saleId, list);
  }
  return bySale;
}

/**
 * Khách KEY của từng sale — distinct theo customer_code, kèm các nhóm mà mã
 * đó thuộc. Một mã có thể thuộc nhiều nhóm nếu nhiều SAP cùng code.
 */
function buildKeyCustomers(
  assignments: CoverageAssignment[],
): Map<number, Map<string, Set<string>>> {
  const bySale = new Map<number, Map<string, Set<string>>>();
  for (const row of assignments) {
    if (String(row.tier ?? '').toUpperCase() !== 'KEY') continue;
    const code = normalizeCode(row.customerCode);
    if (!code) continue;
    const byCode = bySale.get(row.saleId) ?? new Map<string, Set<string>>();
    const groups = byCode.get(code) ?? new Set<string>();
    groups.add(coverageGroupKey(row));
    byCode.set(code, groups);
    bySale.set(row.saleId, byCode);
  }
  return bySale;
}

/**
 * Mã KEY được cover khi có ít nhất một thành viên CÙNG TIER trong nhóm phát
 * sinh (quantity > 0). Mỗi mã CON vẫn là một khách riêng — nếu MẸ KEY đã bán
 * thì toàn bộ CON KEY cùng nhóm đều được cover.
 */
function coveredKeyCodes(
  saleAssignments: CoverageAssignment[],
  keyGroups: Map<string, Set<string>>,
  revenue: Map<string, { quantity: number; lineTotal: number }>,
): Set<string> {
  const reachedGroups = new Set<string>();
  for (const row of saleAssignments) {
    const tier = String(row.tier ?? '').toUpperCase();
    if (tier !== 'KEY' && tier !== 'NON') continue;
    if ((revenue.get(normalizeCode(row.customerCode))?.quantity ?? 0) <= 0) {
      continue;
    }
    reachedGroups.add(`${tier}|${coverageGroupKey(row)}`);
  }
  const covered = new Set<string>();
  for (const [code, groups] of keyGroups) {
    for (const group of groups) {
      if (reachedGroups.has(`KEY|${group}`)) {
        covered.add(code);
        break;
      }
    }
  }
  return covered;
}

/** Doanh thu theo khách của một sale trong kỳ (cộng các slpCode của sale). */
function revenueByCustomerOfSale(
  revenueIndex: Map<
    number,
    Map<string, { quantity: number; lineTotal: number }>
  >,
  slpCodes: number[],
): Map<string, { quantity: number; lineTotal: number }> {
  const result = new Map<string, { quantity: number; lineTotal: number }>();
  for (const slpCode of slpCodes) {
    const byCustomer = revenueIndex.get(slpCode);
    if (!byCustomer) continue;
    for (const [customerCode, value] of byCustomer) {
      const current = result.get(customerCode) ?? {
        quantity: 0,
        lineTotal: 0,
      };
      current.quantity += value.quantity;
      current.lineTotal += value.lineTotal;
      result.set(customerCode, current);
    }
  }
  return result;
}

/**
 * Độ phủ tháng:
 *   N_key       = số khách KEY được giao
 *   Covered_key = số khách KEY có quantity > 0 trong tháng
 *   status      = PASSED nếu coverage_rate >= targetRate; N_key = 0 -> EXEMPT
 *   không map được slpCode -> PENDING (không kết luận trượt oan)
 */
export function computeMonthlyCoverage(
  assignments: CoverageAssignment[],
  revenueRows: CoverageRevenueRow[],
  mappings: SaleSlpMapping[],
  targetRate = 60,
): Map<number, MonthlyCoverageResult> {
  const keysBySale = buildKeyCustomers(assignments);
  const assignmentsBySale = indexAssignmentsBySale(assignments);
  const revenueIndex = buildRevenueIndex(revenueRows);
  const result = new Map<number, MonthlyCoverageResult>();

  for (const mapping of mappings) {
    const keyGroups =
      keysBySale.get(mapping.saleId) ?? new Map<string, Set<string>>();
    const keyCodes = [...keyGroups.keys()].sort();
    const hasMapping = mapping.slpCodes.length > 0;
    const revenue = revenueByCustomerOfSale(revenueIndex, mapping.slpCodes);
    const coveredSet = coveredKeyCodes(
      assignmentsBySale.get(mapping.saleId) ?? [],
      keyGroups,
      revenue,
    );
    const coveredCodes = keyCodes.filter((code) => coveredSet.has(code));
    const nKey = keyCodes.length;
    const coveredKey = coveredCodes.length;
    const coverageRate = nKey > 0 ? round2((coveredKey / nKey) * 100) : 0;

    let status: KpiMonthlyStatus;
    if (nKey === 0) {
      status = KpiMonthlyStatus.EXEMPT_NO_KEY;
    } else if (!hasMapping) {
      status = KpiMonthlyStatus.PENDING;
    } else if (coverageRate >= targetRate) {
      status = KpiMonthlyStatus.PASSED;
    } else {
      status = KpiMonthlyStatus.FAILED;
    }

    result.set(mapping.saleId, {
      saleId: mapping.saleId,
      nKey,
      coveredKey,
      coverageRate,
      status,
      keyCodes,
      coveredCodes,
      hasMapping,
    });
  }

  return result;
}

/**
 * Quyết toán quý:
 *   - Doanh số: dùng actual_value của S1; nếu actual_value = 0 nhưng daily > 0
 *     thì fallback daily và ghi rõ revenue_source (không tự phân bổ lại).
 *   - Độ phủ: phải 100% N_key; N_key = 0 -> miễn trừ.
 *   - Thiếu target / thiếu mapping -> PENDING_DATA, không kết luận.
 */
export function computeQuarterSettlement(
  assignments: CoverageAssignment[],
  revenueRows: CoverageRevenueRow[],
  mappings: SaleSlpMapping[],
  targets: QuarterTargetInput[],
): Map<number, QuarterSettlementResult> {
  const keysBySale = buildKeyCustomers(assignments);
  const assignmentsBySale = indexAssignmentsBySale(assignments);
  const revenueIndex = buildRevenueIndex(revenueRows);
  const targetBySale = new Map(targets.map((row) => [row.saleId, row]));
  const result = new Map<number, QuarterSettlementResult>();

  for (const mapping of mappings) {
    const target = targetBySale.get(mapping.saleId) ?? {
      saleId: mapping.saleId,
      targetValue: 0,
      actualValue: 0,
      hasTarget: false,
    };
    const keyGroups =
      keysBySale.get(mapping.saleId) ?? new Map<string, Set<string>>();
    const keyCodes = [...keyGroups.keys()].sort();
    const revenue = revenueByCustomerOfSale(revenueIndex, mapping.slpCodes);
    const coveredSet = coveredKeyCodes(
      assignmentsBySale.get(mapping.saleId) ?? [],
      keyGroups,
      revenue,
    );
    const coveredCodes = keyCodes.filter((code) => coveredSet.has(code));
    const nKey = keyCodes.length;
    const coveredKey = coveredCodes.length;
    const keyCoverageRate = nKey > 0 ? round2((coveredKey / nKey) * 100) : 0;

    const dailyTotal = [...revenue.values()].reduce(
      (total, item) => total + item.lineTotal,
      0,
    );
    let actualRevenue = Number(target.actualValue) || 0;
    let revenueSource = 's1_quarter_api';
    if (target.hasTarget && actualRevenue === 0 && dailyTotal > 0) {
      actualRevenue = round2(dailyTotal);
      revenueSource = 'daily_fallback';
    }

    let status: KpiQuarterStatus;
    if (mapping.slpCodes.length === 0) {
      status = KpiQuarterStatus.PENDING_DATA;
      revenueSource = 'missing_mapping';
    } else if (!target.hasTarget) {
      status = KpiQuarterStatus.PENDING_DATA;
      revenueSource = 'missing_target';
    } else if ((Number(target.targetValue) || 0) <= 0) {
      status = KpiQuarterStatus.PENDING_DATA;
      revenueSource = 'missing_target';
    } else {
      const revenueAchieved = actualRevenue >= Number(target.targetValue);
      const keyAchieved = nKey === 0 ? true : coveredKey === nKey;
      if (nKey === 0) {
        status = revenueAchieved
          ? KpiQuarterStatus.EXEMPT_NO_KEY
          : KpiQuarterStatus.FAILED_REVENUE;
      } else if (revenueAchieved && keyAchieved) {
        status = KpiQuarterStatus.PASSED;
      } else if (!revenueAchieved && keyAchieved) {
        status = KpiQuarterStatus.FAILED_REVENUE;
      } else if (revenueAchieved && !keyAchieved) {
        status = KpiQuarterStatus.FAILED_KEY_COVERAGE;
      } else {
        status = KpiQuarterStatus.FAILED_BOTH;
      }
    }

    const revenueAchieved =
      Number(target.targetValue) > 0 &&
      actualRevenue >= Number(target.targetValue);
    const keyAchieved = nKey === 0 ? true : coveredKey === nKey;

    result.set(mapping.saleId, {
      saleId: mapping.saleId,
      nKey,
      coveredKey,
      keyCoverageRate,
      targetValue: Number(target.targetValue) || 0,
      actualRevenue,
      revenueSource,
      revenueAchieved,
      keyAchieved,
      status,
      keyCodes,
      coveredCodes,
    });
  }

  return result;
}

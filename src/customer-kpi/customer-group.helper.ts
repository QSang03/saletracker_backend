import {
  ActivityDayRow,
  CustomerOrderSuggestion,
} from './customer-kpi-scoring.service';

/**
 * Hàm thuần gộp bằng chứng KPI cho MỘT nhóm khách gộp (MẸ + CON) trong CÙNG
 * một sale.
 *
 * Vì sao cần: tiêu chí KPI được chấm theo từng dòng phân công, nhưng khách gộp
 * là một thực thể — MẸ thường là mã duy nhất có Zalo/doanh số/lịch hẹn. Các CON
 * phải nhận cùng kết quả tiêu chí với MẸ (trừ doanh số tách theo tier).
 *
 * Nguyên tắc:
 * - `days`: gộp activity của các THÀNH VIÊN KHÁC NHAU; cùng một customerId xuất
 *   hiện ở nhiều phòng ban chỉ được gộp một lần để không đếm trùng tin nhắn.
 * - `revenue`: `keyReached`/`nonReached` xét từng assignment gốc (một khách có
 *   thể KEY ở phòng A, NON ở phòng B); `quantity`/`lineTotal` để hiển thị thì
 *   dedupe theo customerId vì doanh thu NKM gắn với cặp (customer_code, sale),
 *   không gắn phòng ban.
 * - `openOrders`/`debt`: gộp theo customerId rồi cộng giữa các thành viên.
 * - Mọi thứ đều đã được lọc theo CÙNG sale ở tầng gọi (reports service).
 */

export type GroupRole = 'ME' | 'CON';

export interface GroupMemberEvidenceInput {
  customerId: number;
  tier: string | null;
  days: ActivityDayRow[];
  /** Doanh số riêng của assignment (customer_code + sale). */
  revenue?: { quantity: number; lineTotal: number } | null;
  /** Gợi ý đơn hàng chưa chốt của assignment. */
  openOrders?: CustomerOrderSuggestion | null;
  debtBalance?: number | null;
  /**
   * Lý do không lấy được lịch hẹn (sync stale...). `undefined` = thành viên
   * này CÓ dữ liệu lịch hẹn → cả nhóm coi như có dữ liệu.
   */
  appointmentReason?: string;
}

export interface GroupRevenueEvidence {
  /** Có thành viên tier KEY phát sinh doanh số. */
  keyReached: boolean;
  /** Có thành viên tier NON phát sinh doanh số. */
  nonReached: boolean;
  /** Số phiếu + doanh số của các KHÁCH KHÁC NHAU trong nhóm (để hiển thị). */
  quantity: number;
  lineTotal: number;
  hasRevenue: boolean;
}

export interface GroupEvidence {
  days: ActivityDayRow[];
  revenue: GroupRevenueEvidence;
  openOrders: CustomerOrderSuggestion | null;
  /** Tổng nợ các khách khác nhau trong nhóm; `null` = không có dữ liệu. */
  debtBalance: number | null;
  /** `undefined` = ít nhất một thành viên có dữ liệu lịch hẹn. */
  appointmentReason?: string;
}

const tierRank = (tier: string | null | undefined): number => {
  const upper = String(tier ?? '').toUpperCase();
  return upper === 'KEY' ? 2 : upper === 'NON' ? 1 : 0;
};

/** Gộp activity theo ngày; cộng count, OR zalo_linked, cộng movement_count. */
export const mergeActivityDays = (
  rows: ActivityDayRow[],
): ActivityDayRow[] => {
  const byDate = new Map<string, ActivityDayRow>();
  for (const row of rows) {
    const current = byDate.get(row.stat_date);
    if (!current) {
      byDate.set(row.stat_date, {
        ...row,
        movement_count: row.movement_count ?? 0,
      });
      continue;
    }
    current.inbound_count += row.inbound_count;
    current.outbound_count += row.outbound_count;
    current.order_count += row.order_count;
    current.revenue += row.revenue;
    current.zalo_linked = current.zalo_linked || row.zalo_linked;
    current.movement_count =
      (current.movement_count ?? 0) + (row.movement_count ?? 0);
  }
  return [...byDate.values()].sort((a, b) =>
    a.stat_date.localeCompare(b.stat_date),
  );
};

const mergeOpenOrders = (
  rows: Array<CustomerOrderSuggestion | null | undefined>,
): CustomerOrderSuggestion | null => {
  let count = 0;
  let totalValue = 0;
  let latestOrderDate: string | null = null;
  for (const row of rows) {
    if (!row) continue;
    count += Number(row.count) || 0;
    totalValue += Number(row.totalValue) || 0;
    if (
      row.latestOrderDate &&
      (!latestOrderDate || row.latestOrderDate > latestOrderDate)
    ) {
      latestOrderDate = row.latestOrderDate;
    }
  }
  if (count === 0 && totalValue === 0 && !latestOrderDate) return null;
  return { count, totalValue, latestOrderDate };
};

/**
 * Gộp các assignment của CÙNG một khách (một khách có thể có 2 phòng ban
 * trong cùng sale). Day/activity cộng dồn; doanh thu/nợ giữ một bản vì cùng
 * customer_code + sale; open orders cộng dồn.
 */
const dedupeMembers = (
  members: GroupMemberEvidenceInput[],
): GroupMemberEvidenceInput[] => {
  const byCustomer = new Map<number, GroupMemberEvidenceInput>();
  for (const member of members) {
    const current = byCustomer.get(member.customerId);
    if (!current) {
      byCustomer.set(member.customerId, {
        ...member,
        days: [...member.days],
        openOrders: member.openOrders ?? null,
      });
      continue;
    }
    current.days = mergeActivityDays([...current.days, ...member.days]);
    if (current.revenue == null && member.revenue) {
      current.revenue = member.revenue;
    }
    if (current.debtBalance == null && member.debtBalance != null) {
      current.debtBalance = member.debtBalance;
    }
    current.openOrders = mergeOpenOrders([
      current.openOrders,
      member.openOrders,
    ]);
    if (tierRank(member.tier) > tierRank(current.tier)) {
      current.tier = member.tier;
    }
    if (!current.appointmentReason) {
      current.appointmentReason = member.appointmentReason;
    }
  }
  return [...byCustomer.values()];
};

const buildGroupRevenue = (
  members: GroupMemberEvidenceInput[],
): GroupRevenueEvidence => {
  let keyReached = false;
  let nonReached = false;
  for (const member of members) {
    if ((member.revenue?.quantity ?? 0) <= 0) continue;
    const tier = String(member.tier ?? '').toUpperCase();
    if (tier === 'KEY') keyReached = true;
    else if (tier === 'NON') nonReached = true;
  }
  // Hiển thị: mỗi KHÁCH một lần, tránh nhân đôi doanh thu cùng mã ở 2 phòng.
  const seen = new Set<number>();
  let quantity = 0;
  let lineTotal = 0;
  for (const member of members) {
    if (seen.has(member.customerId)) continue;
    seen.add(member.customerId);
    quantity += Number(member.revenue?.quantity) || 0;
    lineTotal += Number(member.revenue?.lineTotal) || 0;
  }
  return {
    keyReached,
    nonReached,
    quantity,
    lineTotal,
    hasRevenue: keyReached || nonReached || quantity > 0,
  };
};

/**
 * Dựng toàn bộ bằng chứng nhóm từ danh sách assignment cùng sale.
 * Caller chỉ nên gọi khi nhóm có >1 khách hoặc có dòng CON (parent != null);
 * khách đứng riêng giữ nguyên cách chấm từng assignment như cũ.
 */
export const buildGroupEvidence = (
  members: GroupMemberEvidenceInput[],
): GroupEvidence => {
  const deduped = dedupeMembers(members);
  const days = mergeActivityDays(deduped.flatMap((member) => member.days));
  const debtValues = deduped
    .map((member) => member.debtBalance)
    .filter((value): value is number => value != null);
  // Chỉ cần một thành viên có dữ liệu lịch hẹn là cả nhóm chấm được; lý do
  // "chưa đồng bộ" chỉ giữ khi TẤT CẢ đều không có dữ liệu.
  const hasAppointmentData = members.some(
    (member) => member.appointmentReason === undefined,
  );
  return {
    days,
    revenue: buildGroupRevenue(members),
    openOrders: mergeOpenOrders(deduped.map((member) => member.openOrders)),
    debtBalance:
      debtValues.length > 0
        ? debtValues.reduce((total, value) => total + value, 0)
        : null,
    appointmentReason: hasAppointmentData
      ? undefined
      : members.find((member) => member.appointmentReason)?.appointmentReason,
  };
};

/** Vai trò hiển thị của khách trong nhóm. */
export const groupRoleOf = (
  parentCustomerId: number | null | undefined,
  customerRole: string | null | undefined,
): GroupRole | null => {
  if (parentCustomerId != null) return 'CON';
  const role = String(customerRole ?? '').toUpperCase();
  if (role === 'PHU') return 'CON';
  if (role === 'CHINH') return 'ME';
  return null;
};

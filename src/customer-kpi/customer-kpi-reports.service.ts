import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { User } from '../users/user.entity';
import { Debt, DebtStatus } from '../debts/debt.entity';
import { Customer } from './customer.entity';
import { CustomerAssignment } from './customer-assignment.entity';
import { CustomerActivityDaily } from './customer-activity-daily.entity';
import { CustomerMovementReport } from './customer-movement-report.entity';
import { CustomerRevenueDaily } from './customer-revenue-daily.entity';
import { DeptRevenueTarget } from './dept-revenue-target.entity';
import { NkmSaleMap } from './nkm-sale-map.entity';
import { SaleRevenueTarget } from './sale-revenue-target.entity';
import { KpiCriterionOverride } from './kpi-criterion-overrides.entity';
import { KpiDefinition, ScoringMode } from './kpi-definition.entity';
import { KpiTarget } from './kpi-target.entity';
import { CustomersService } from './customers.service';
import { diffDateStr, shiftDateStr, vnToday } from './vn-date';
import {
  ActivityDayRow,
  CustomerCriterion,
  CustomerKpiScoringService,
  CustomerTierSummary,
  REVENUE_METRICS,
  RevenueCustomerInput,
  SaleCriterion,
  SUGGESTION_GAP_DAYS,
  roundTo,
} from './customer-kpi-scoring.service';
import {
  currentFiscalQuarter,
  FiscalQuarter,
  fiscalQuarterCovering,
  fiscalQuarterRange,
} from './nkm-fiscal';
import {
  KpiCustomerFilters,
  KpiCriterionStatus,
  KpiSaleFilters,
  KPI_SORT_KEYS,
  filterKpiCustomers,
  filterKpiSales,
  sortKpiCustomers,
  summarizeKpiSales,
} from './kpi-report-filter';

/** Nhóm gợi ý thực hiện (mục 5.4) — thứ tự = mức độ khẩn cấp. */
const SUGGESTION_REASONS: Record<string, string> = {
  chua_phan_hoi: 'Khách nhắn tin chưa được phản hồi',
  key_chua_lien_lac: 'Khách KEY đã lâu không được liên lạc',
  non_don_moi_chua_cham: 'Khách NON có đơn mới nhưng chưa được chăm sóc',
};

/**
 * Mức khẩn cấp tường minh của từng nhóm gợi ý (số nhỏ = khẩn hơn). Sắp xếp
 * theo bảng này thay vì alphabetical reason code — đổi tên mã không làm vỡ
 * thứ tự ưu tiên hiển thị.
 */
const SUGGESTION_REASON_PRIORITY: Record<string, number> = {
  chua_phan_hoi: 1,
  key_chua_lien_lac: 2,
  non_don_moi_chua_cham: 3,
};

const SUGGESTION_LIMIT_PER_SALE = 20;

/** Một sự kiện báo cáo di chuyển thô, đọc từ customer_movement_reports. */
interface MovementEventRow {
  user_id: number;
  customer_code: string;
  sent_at: Date | string;
}

/**
 * Khoảng xem của báo cáo. `quarter != null` nghĩa là khoảng xem phủ trọn một
 * QUÝ TÀI CHÍNH — chỉ khi đó mới so chỉ tiêu quý và kết luận đạt/không đạt.
 */
export interface KpiWindow {
  from: string;
  to: string;
  quarter: FiscalQuarter | null;
  /** Sale có chỉ tiêu quý cần lấy theo quý này. */
  isWholeQuarter: boolean;
}

/** Dòng doanh thu đã đọc — tổng kỳ theo từng khách. */
interface CustomerRevenueAmount {
  quantity: number;
  lineTotal: number;
}

interface AssignmentRow {
  assignmentId: number;
  saleId: number;
  customerId: number;
  customerCode: string;
  customerName: string;
  customerTier: string | null;
  customerRole: string | null;
  departmentSlug: string;
  sapCode: string;
}

/** Dòng phân phối của một sale trong báo cáo 3 cấp (pivot của lead). */
export interface SaleRevenueRow {
  keyCustomers: { reached: number; total: number };
  nonCustomers: { reached: number; total: number };
  /** Doanh số khách KEY trong kỳ (chưa VAT) — `null` khi chưa đồng bộ được. */
  dsoKey: number | null;
  dsoNon: number | null;
  keyShareRatio: number | null;
  quarterTarget: number | null;
  achievedRatio: number | null;
  achievedPct: number | null;
  verdict: 'pass' | 'fail' | null;
  /** "x/y khách KEY đạt toàn bộ tiêu chí" (lớp tổng hợp theo loại khách). */
  keyFullyPassed: { passed: number; total: number } | null;
  /** Khách NON: đếm tiêu chí đạt / tổng tiêu chí đã áp dụng (không kết luận). */
  nonCriteria: { passed: number; applicable: number; customers: number } | null;
}

/**
 * Dữ liệu doanh thu của một khách để nạp adapter. `undefined` (chưa đồng bộ được
 * dữ liệu NKM, hoặc sale chưa tra được mã) KHÁC với "khách không mua gì":
 * adapter sẽ trả no_data kèm lý do thay vì kết luận trượt oan.
 */
const revenueData = (
  loaded: { bySale: Map<number, RevenueCustomerInput[]> } | undefined,
  customer:
    | { tier: string | null; quantity: number; lineTotal: number }
    | undefined,
) => (loaded ? customer : undefined);

/**
 * Báo cáo KPI. Engine chấm điểm nằm ở CustomerKpiScoringService (tính lúc đọc
 * từ kpi_definitions + customer_activity_daily — sửa tiêu chí là hiện ngay,
 * không đợi cron). Bảng customer_response_daily chỉ dùng cho màn hình chi tiết
 * khách hàng (mục 4.7 — không dùng chấm KPI).
 *
 * Tiêu chí doanh số đọc thêm `customer_revenue_daily` + `sale_revenue_target`
 * (job đồng bộ API NKM ghi) — xem THIET-KE-DOANH-SO-API-NKM.md. Báo cáo trả
 * theo BA CẤP tuân thủ bảng phân phối khách / doanh số: Sale / QL Nhóm / QL KD.
 */
@Injectable()
export class CustomerKpiReportsService {
  constructor(
    private readonly scoring: CustomerKpiScoringService,
    @InjectRepository(CustomerActivityDaily)
    private readonly activityRepo: Repository<CustomerActivityDaily>,
    @InjectRepository(KpiDefinition)
    private readonly definitionRepo: Repository<KpiDefinition>,
    @InjectRepository(KpiTarget)
    private readonly targetRepo: Repository<KpiTarget>,
    @InjectRepository(CustomerAssignment)
    private readonly assignmentRepo: Repository<CustomerAssignment>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Debt)
    private readonly debtRepo: Repository<Debt>,
    @InjectRepository(CustomerMovementReport)
    private readonly movementRepo: Repository<CustomerMovementReport>,
    @InjectRepository(KpiCriterionOverride)
    private readonly overrideRepo: Repository<KpiCriterionOverride>,
    @InjectRepository(CustomerRevenueDaily)
    private readonly revenueRepo: Repository<CustomerRevenueDaily>,
    @InjectRepository(SaleRevenueTarget)
    private readonly quarterTargetRepo: Repository<SaleRevenueTarget>,
    @InjectRepository(DeptRevenueTarget)
    private readonly deptTargetRepo: Repository<DeptRevenueTarget>,
    @InjectRepository(NkmSaleMap)
    private readonly saleMapRepo: Repository<NkmSaleMap>,
    private readonly customersService: CustomersService,
  ) {}

  /**
   * Phạm vi xem báo cáo — cùng luật với scopeUserIds của CustomersService
   * (admin/PM/view toàn công ty, manager theo phòng, user chỉ mình). Khác
   * resolveScope của sale-response: trang khách hàng không yêu cầu role
   * 'analysis' (quyết định ghi ở CustomerKpiModule).
   */
  private async scopeUserIds(user: any): Promise<number[] | undefined> {
    if (!user?.id)
      throw new ForbiddenException('Không xác định được người dùng');
    const lower: string[] = (user.roles || []).map((r: any) =>
      (typeof r === 'string' ? r : r?.name || '').toLowerCase(),
    );
    if (
      lower.includes('admin') ||
      lower.includes('pm') ||
      lower.includes('view') ||
      lower.some((r) => r.startsWith('pm-'))
    ) {
      return undefined;
    }
    if (lower.some((r) => r.startsWith('manager-'))) {
      const departmentIds = (user.departments || [])
        .map((d: any) => d?.id)
        .filter(Boolean);
      if (departmentIds.length === 0) return [];
      const users = await this.userRepo
        .createQueryBuilder('user')
        .leftJoin('user.departments', 'dept')
        .where('dept.id IN (:...departmentIds)', { departmentIds })
        .andWhere('user.deletedAt IS NULL')
        .getMany();
      return users.map((u) => u.id);
    }
    return [user.id];
  }

  private assertSaleInScope(saleId: number, userIds: number[] | undefined) {
    if (userIds !== undefined && !userIds.includes(saleId)) {
      throw new ForbiddenException('Bạn không có quyền xem sale này');
    }
  }

  // ------------------------------------------------------------- loaders

  private async loadAssignments(
    userIds: number[] | undefined,
    saleId: number | undefined,
  ): Promise<AssignmentRow[]> {
    const qb = this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.customer', 'c')
      .where('c.status <> :deleted', { deleted: 'deleted' });
    const effectiveSale = saleId ?? undefined;
    if (effectiveSale !== undefined) {
      qb.andWhere('a.sale_id = :saleId', { saleId: effectiveSale });
    } else if (userIds !== undefined) {
      if (userIds.length === 0) return [];
      qb.andWhere('a.sale_id IN (:...userIds)', { userIds });
    }
    const rows = await qb.getMany();
    return rows.map((row) => ({
      assignmentId: row.id,
      saleId: row.sale_id,
      customerId: row.customer_id,
      customerCode: row.customer?.customer_code ?? '',
      customerName: row.customer?.customer_name ?? '',
      // Key/Non theo TỪNG PHÒNG BAN nên nằm trên dòng phân công, không phải khách
      customerTier: row.customer_tier ?? null,
      customerRole: row.customer?.customer_role ?? null,
      departmentSlug: row.department_slug ?? '',
      sapCode: row.customer?.sap_code ?? '',
    }));
  }

  /**
   * mysql2 trả cột DATE là Date object (nửa đêm LOCAL) — String(date) cho ra
   * chuỗi locale ("Mon Oct 06...") làm vỡ mọi so sánh/sort theo ngày. Ép về
   * YYYY-MM-DD theo múi giờ local.
   */
  private fmtDate(value: unknown): string {
    if (value instanceof Date) {
      const p = (n: number) => String(n).padStart(2, '0');
      return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
    }
    return String(value ?? '');
  }

  /** Hoạt động theo ngày cho từng phân công, chunked để không nổ IN (). */
  private async loadActivity(
    assignmentIds: number[],
    from: string,
    to: string,
  ): Promise<Map<number, ActivityDayRow[]>> {
    const result = new Map<number, ActivityDayRow[]>();
    for (let i = 0; i < assignmentIds.length; i += 1000) {
      const chunk = assignmentIds.slice(i, i + 1000);
      const rows = await this.activityRepo
        .createQueryBuilder('d')
        .where('d.assignment_id IN (:...ids)', { ids: chunk })
        .andWhere('d.stat_date >= :from', { from })
        .andWhere('d.stat_date <= :to', { to })
        .orderBy('d.assignment_id', 'ASC')
        .addOrderBy('d.stat_date', 'ASC')
        .getMany();
      for (const row of rows) {
        const list = result.get(row.assignment_id) ?? [];
        list.push({
          stat_date: this.fmtDate(row.stat_date),
          inbound_count: Number(row.inbound_count) || 0,
          outbound_count: Number(row.outbound_count) || 0,
          order_count: Number(row.order_count) || 0,
          revenue: Number(row.revenue) || 0,
          zalo_linked: Boolean(row.zalo_linked),
        });
        result.set(row.assignment_id, list);
      }
    }
    return result;
  }

  /**
   * Sự kiện báo cáo di chuyển (tiêu chí 3) của các sale trong cửa sổ — job
   * Python ghi theo (user_id, mã KH). Chỉ nạp trong [from, to]: tiêu chí này
   * không cần lookback. `to` là ngày cuối cửa sổ nên phải cộng 1 ngày để
   * so sánh với cột DATETIME (không mất ngày cuối).
   */
  private async loadMovementEvents(
    saleIds: number[],
    from: string,
    to: string,
  ): Promise<MovementEventRow[]> {
    if (saleIds.length === 0) return [];
    const toExclusive = this.shiftDate(to, 1);
    return this.movementRepo
      .createQueryBuilder('m')
      .select('m.user_id', 'user_id')
      .addSelect('m.customer_code', 'customer_code')
      .addSelect('m.sent_at', 'sent_at')
      .where('m.user_id IN (:...saleIds)', { saleIds: [...new Set(saleIds)] })
      .andWhere('m.sent_at >= :from', { from })
      .andWhere('m.sent_at < :toExclusive', { toExclusive })
      .getRawMany<MovementEventRow>();
  }

  /**
   * Ghép sự kiện báo cáo di chuyển vào map ngày hoạt động. Khớp theo
   * (user_id, customer_code chuẩn hoá) — NestJS tự tra khách của sale, job
   * Python không cần biết bảng khách. Ngày chưa có dòng thì tạo dòng mới với
   * inbound/outbound = 0 và zalo_linked = false (các metric Zalo lọc
   * zalo_linked nên không bị ảnh hưởng; adapter movement_report không gate).
   */
  private mergeMovementReports(
    activity: Map<number, ActivityDayRow[]>,
    rows: AssignmentRow[],
    events: MovementEventRow[],
  ): void {
    if (events.length === 0) return;
    const normCode = (value: unknown): string =>
      String(value ?? '')
        .trim()
        .toLowerCase();
    // (user_id | mã KH) -> ngày -> số tin
    const counts = new Map<string, Map<string, number>>();
    for (const event of events) {
      const key = `${Number(event.user_id)}|${normCode(event.customer_code)}`;
      const day =
        event.sent_at instanceof Date
          ? this.fmtDate(event.sent_at)
          : String(event.sent_at ?? '').slice(0, 10);
      if (!day) continue;
      const byDay = counts.get(key) ?? new Map<string, number>();
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      counts.set(key, byDay);
    }
    for (const row of rows) {
      const byDay = counts.get(`${row.saleId}|${normCode(row.customerCode)}`);
      if (!byDay) continue;
      const days = activity.get(row.assignmentId) ?? [];
      for (const [day, count] of byDay) {
        const existing = days.find((d) => d.stat_date === day);
        if (existing) {
          existing.movement_count = (existing.movement_count ?? 0) + count;
        } else {
          days.push({
            stat_date: day,
            inbound_count: 0,
            outbound_count: 0,
            order_count: 0,
            revenue: 0,
            zalo_linked: false,
            movement_count: count,
          });
        }
      }
      days.sort((a, b) => a.stat_date.localeCompare(b.stat_date));
      activity.set(row.assignmentId, days);
    }
  }

  /**
   * Thông tin sale cần cho báo cáo: tên hiển thị, trạng thái Zalo, MÃ NHÂN VIÊN
   * (để nối bảng tra NKM) và phòng ban (để gom nhóm QL Nhóm / QL KD). Chỉ trả
   * phòng ban CÓ server_ip — phòng không có IP không quét KPI được nên không
   * thuộc báo cáo này.
   */
  private async loadSaleInfos(saleIds: number[]): Promise<
    Map<
      number,
      {
        fullName: string;
        zaloLinked: boolean;
        employeeCode: string | null;
        departments: { slug: string; name: string }[];
      }
    >
  > {
    const result = new Map<
      number,
      {
        fullName: string;
        zaloLinked: boolean;
        employeeCode: string | null;
        departments: { slug: string; name: string }[];
      }
    >();
    if (saleIds.length === 0) return result;
    const users = await this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.departments', 'dept')
      .where('user.id IN (:...ids)', { ids: [...new Set(saleIds)] })
      .andWhere('user.deletedAt IS NULL')
      .select([
        'user.id',
        'user.fullName',
        'user.zaloLinkStatus',
        'user.employeeCode',
      ])
      .addSelect(['dept.id', 'dept.slug', 'dept.name', 'dept.server_ip'])
      .getMany();
    for (const user of users) {
      result.set(user.id, {
        fullName: user.fullName ?? `User #${user.id}`,
        zaloLinked: Number(user.zaloLinkStatus) === 1,
        employeeCode: user.employeeCode ?? null,
        // Chỉ giữ phòng ban có server_ip — phòng không có IP (vd "Chiến
        // dịch") không phải phòng KPI, xuất hiện trong response chỉ gây thừa
        departments: (user.departments ?? [])
          .filter((dept: any) => !!dept.server_ip)
          .map((dept: any) => ({
            slug: dept.slug,
            name: dept.name,
          })),
      });
    }
    return result;
  }

  private async loadDefinitions(): Promise<KpiDefinition[]> {
    return this.definitionRepo.find({
      where: { is_active: true },
      order: { team_group: 'ASC', sort_order: 'ASC' },
    });
  }

  private monthsInRange(from: string, to: string): string[] {
    const months = new Set<string>();
    const cursor = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (cursor <= end) {
      months.add(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return [...months];
  }

  /** Chỉ tiêu theo (sale_id, customer_id, criterion_key) của các tháng trong khoảng. */
  private async loadTargets(
    saleIds: number[],
    criterionKeys: string[],
    months: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (
      saleIds.length === 0 ||
      criterionKeys.length === 0 ||
      months.length === 0
    ) {
      return result;
    }
    const rows = await this.targetRepo.find({
      where: {
        sale_id: In([...new Set(saleIds)]),
        criterion_key: In(criterionKeys),
        period_month: In(months),
      },
    });
    for (const row of rows) {
      result.set(
        `${row.sale_id}|${row.customer_id}|${row.criterion_key}`,
        Number(row.target_value),
      );
    }
    return result;
  }

  /**
   * Ghi đè thủ công theo (sale_id, customer_id, criterion_key, period_month).
   * `customer_id = 0` là ghi đè CẢ DANH SÁCH của sale — mạnh nhất, áp cho mọi
   * khách; >0 là ghi đè riêng từng khách. Chỉ áp cho 2 tiêu chí hành vi
   * (service API chặn key khác trước khi vào bảng).
   */
  private async loadOverrides(
    saleIds: number[],
    criterionKeys: string[],
    months: string[],
  ): Promise<Map<string, KpiCriterionOverride>> {
    const result = new Map<string, KpiCriterionOverride>();
    if (
      saleIds.length === 0 ||
      criterionKeys.length === 0 ||
      months.length === 0
    ) {
      return result;
    }
    const rows = await this.overrideRepo.find({
      where: {
        sale_id: In([...new Set(saleIds)]),
        criterion_key: In(criterionKeys),
        period_month: In(months),
      },
    });
    for (const row of rows) {
      result.set(
        `${row.sale_id}|${row.customer_id}|${row.criterion_key}|${row.period_month}`,
        row,
      );
    }
    return result;
  }

  /**
   * Số dư công nợ hiện tại của từng khách — nguồn cho metric `debt_balance`
   * (adapter Debt đọc thẳng module công nợ, thiết kế mục 5.1.6).
   *
   * Khớp theo `debts.customer_raw_code` (file công nợ ghi cột "Mã đối tác" =
   * mã SAP) trước, không có SAP thì thử mã khách; chỉ tính khoản CHƯA THANH
   * TOÁN (`status <> 'paid'`, `deleted_at IS NULL` mặc dù TypeORM không tự lọc
   * khi dùng QueryBuilder). Khách không định danh được (không có mã nào) →
   * `null` → chấm điểm trả no_data; khớp được nhưng không có khoản nợ → 0.
   *
   * Đây là giá trị ĐIỂM THEO THỜI GIAN (hạn mức/tồn công nợ không chia ngày),
   * không phụ thuộc khoảng `from`–`to` của báo cáo.
   */
  private async loadDebtBalances(
    rows: AssignmentRow[],
  ): Promise<Map<number, number | null>> {
    const result = new Map<number, number | null>();
    if (rows.length === 0) return result;

    const codes = [
      ...new Set(
        rows.flatMap((r) => [r.sapCode, r.customerCode]).filter(Boolean),
      ),
    ];
    const byCode = new Map<string, number>();
    for (let i = 0; i < codes.length; i += 500) {
      const chunk = codes.slice(i, i + 500);
      const raw = await this.debtRepo
        .createQueryBuilder('d')
        .select('d.customer_raw_code', 'code')
        .addSelect('SUM(d.remaining)', 'total')
        .where('d.deleted_at IS NULL')
        .andWhere('d.status <> :paid', { paid: DebtStatus.PAID })
        .andWhere('d.customer_raw_code IN (:...codes)', { codes: chunk })
        .groupBy('d.customer_raw_code')
        .getRawMany();
      for (const row of raw) {
        byCode.set(String(row.code), Number(row.total || 0));
      }
    }

    for (const row of rows) {
      if (row.sapCode && byCode.has(row.sapCode)) {
        result.set(row.customerId, byCode.get(row.sapCode) as number);
      } else if (row.customerCode && byCode.has(row.customerCode)) {
        result.set(row.customerId, byCode.get(row.customerCode) as number);
      } else if (!row.sapCode && !row.customerCode) {
        result.set(row.customerId, null);
      } else {
        result.set(row.customerId, 0);
      }
    }
    return result;
  }

  // ------------------------------------------------- doanh thu (API NKM)

  /**
   * Khoảng xem của báo cáo:
   *
   * - `fiscal_year` + `quarter` → khoảng = ĐÚNG QUÝ TÀI CHÍNH đó (mặc định là
   *   quý hiện tại) — nơi duy nhất có target, % đạt và kết luận đạt/không đạt.
   * - `from`/`to` → khoảng tuỳ chọn (tuần, tháng...). Nếu khoảng đó trọn một
   *   quý thì vẫn so được chỉ tiêu; không thì chỉ báo doanh thu thực.
   *
   * Thứ tự ưu tiên là chuẩn mực của lead: "target cốt lõi là target theo quý".
   */
  private resolveWindow(query: any): KpiWindow {
    const hasYear =
      query.fiscal_year !== undefined &&
      query.fiscal_year !== null &&
      query.fiscal_year !== '';
    const hasQuarter =
      query.quarter !== undefined &&
      query.quarter !== null &&
      query.quarter !== '';
    if (hasYear !== hasQuarter) {
      throw new BadRequestException(
        'fiscal_year và quarter phải đi cùng nhau (hoặc không truyền cái nào)',
      );
    }
    if (hasYear) {
      const range = fiscalQuarterRange(
        Number(query.fiscal_year),
        Number(query.quarter),
      );
      if (!range) {
        throw new BadRequestException(
          `fiscal_year/quarter không hợp lệ: ${query.fiscal_year}/${query.quarter}`,
        );
      }
      return {
        from: range.from,
        to: range.to,
        quarter: range,
        isWholeQuarter: true,
      };
    }

    const isDate = (value: unknown): value is string =>
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const today = vnToday();
    const from = isDate(query.from) ? query.from : undefined;
    const to = isDate(query.to) ? query.to : undefined;
    // Thiếu một đầu thì giữ luật cũ: chỉ có `to` → mặc định 30 ngày trước đó
    const start = from ?? (to ? shiftDateStr(to, -30) : undefined);
    const end = to ?? (from ? today : undefined);
    if (start && end) {
      if (start > end) {
        throw new BadRequestException('from phải nhỏ hơn hoặc bằng to');
      }
      const quarter = fiscalQuarterCovering(start, end);
      return {
        from: start,
        to: end,
        quarter,
        isWholeQuarter: quarter != null,
      };
    }
    // Không khoanh gì → mặc định quý tài chính hiện tại
    const current = currentFiscalQuarter(today);
    return {
      from: current.from,
      to: current.to,
      quarter: current,
      isWholeQuarter: true,
    };
  }

  /**
   * Doanh thu trong kỳ của từng khách, theo từng sale — nạp MỘT lần cho cả báo
   * cáo.
   *
   * Nối ba bước: `users.employee_code` → `nkm_sale_map.employee_code` →
   * `nkm_sale_map.slp_code` → `customer_revenue_daily.slp_code`. Mã khách tra
   * theo `customer_code` (đúng như CardCode API trả về). Khách do nhiều sale
   * cùng quản lý thì mỗi sale chỉ lấy phần phiếu do mình bán — không đếm trùng.
   */
  private async loadRevenue(
    assignments: AssignmentRow[],
    saleInfos: Map<number, { employeeCode: string | null }>,
    from: string,
    to: string,
  ): Promise<{
    byAssignment: Map<number, CustomerRevenueAmount>;
    bySale: Map<number, RevenueCustomerInput[]>;
    /** Sale không tra được mã nhân viên NKM — chưa nạp bảng tra mã. */
    salesWithoutMapping: Set<number>;
  }> {
    const byAssignment = new Map<number, CustomerRevenueAmount>();
    const bySale = new Map<number, RevenueCustomerInput[]>();
    const salesWithoutMapping = new Set<number>();
    if (assignments.length === 0) {
      return { byAssignment, bySale, salesWithoutMapping };
    }

    const saleMap = await this.saleMapRepo.find({
      where: { is_active: true },
      select: ['slp_code', 'employee_code'],
    });
    const slpByEmployeeCode = new Map<string, number[]>();
    for (const row of saleMap) {
      const list = slpByEmployeeCode.get(row.employee_code) ?? [];
      list.push(row.slp_code);
      slpByEmployeeCode.set(row.employee_code, list);
    }

    const slpCodesOf = new Map<number, number[]>();
    const allSlp = new Set<number>();
    for (const row of assignments) {
      const employeeCode = saleInfos.get(row.saleId)?.employeeCode ?? null;
      const codes = employeeCode
        ? (slpByEmployeeCode.get(employeeCode) ?? [])
        : [];
      slpCodesOf.set(row.saleId, codes);
      codes.forEach((code) => allSlp.add(code));
      if (codes.length === 0) salesWithoutMapping.add(row.saleId);
    }

    // (slp_code|mã khách) → tổng phiếu + doanh số trong kỳ
    const totals = new Map<string, CustomerRevenueAmount>();
    const codes = [...allSlp];
    for (let i = 0; i < codes.length; i += 200) {
      const chunk = codes.slice(i, i + 200);
      const rows = await this.revenueRepo
        .createQueryBuilder('r')
        .select('r.slp_code', 'slpCode')
        .addSelect('r.customer_code', 'customerCode')
        .addSelect('SUM(r.quantity)', 'quantity')
        .addSelect('SUM(r.line_total)', 'lineTotal')
        .where('r.slp_code IN (:...slp)', { slp: chunk })
        .andWhere('r.stat_date >= :from', { from })
        .andWhere('r.stat_date <= :to', { to })
        .groupBy('r.slp_code')
        .addGroupBy('r.customer_code')
        .getRawMany<{
          slpCode: number;
          customerCode: string;
          quantity: string;
          lineTotal: string;
        }>();
      for (const row of rows) {
        totals.set(`${row.slpCode}|${String(row.customerCode)}`, {
          quantity: Number(row.quantity) || 0,
          lineTotal: Number(row.lineTotal) || 0,
        });
      }
    }

    for (const row of assignments) {
      const codes = slpCodesOf.get(row.saleId) ?? [];
      let quantity = 0;
      let lineTotal = 0;
      for (const slp of codes) {
        const found = totals.get(`${slp}|${row.customerCode}`);
        if (found) {
          quantity += found.quantity;
          lineTotal += found.lineTotal;
        }
      }
      byAssignment.set(row.assignmentId, { quantity, lineTotal });
      const list = bySale.get(row.saleId) ?? [];
      list.push({
        customerId: row.customerId,
        tier: row.customerTier,
        quantity,
        lineTotal,
      });
      bySale.set(row.saleId, list);
    }
    return { byAssignment, bySale, salesWithoutMapping };
  }

  /** Chỉ tiêu quý của từng sale — cả hai tiêu chí doanh số dùng chung. */
  private async loadQuarterTargets(
    slpCodes: number[],
    quarter: FiscalQuarter,
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    if (slpCodes.length === 0) return result;
    const rows = await this.quarterTargetRepo.find({
      where: {
        slp_code: In([...new Set(slpCodes)]),
        fiscal_year: quarter.fiscalYear,
        quarter: quarter.quarter,
      },
    });
    for (const row of rows) {
      result.set(row.slp_code, Number(row.target_value) || 0);
    }
    return result;
  }

  /**
   * Chỉ tiêu cấp NHÓM do người quản lý nhập tay. Không có dòng thì nhóm lấy
   * TỔNG chỉ tiêu quý của các sale trong phòng — API quý chỉ có target theo
   * sale nên đây là cách chia mặc định, có dòng thì dùng dòng nhập tay.
   */
  private async loadDeptTargets(
    deptSlugs: string[],
    quarter: FiscalQuarter,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (deptSlugs.length === 0) return result;
    const rows = await this.deptTargetRepo.find({
      where: {
        dept_slug: In([...new Set(deptSlugs)]),
        fiscal_year: quarter.fiscalYear,
        quarter: quarter.quarter,
      },
    });
    for (const row of rows) {
      result.set(row.dept_slug, Number(row.target_value) || 0);
    }
    return result;
  }

  /** Ngày chưa chốt (hôm nay) trong khoảng xem — FE hiện nhãn "tạm tính". */
  private async loadProvisionalDates(
    slpCodes: number[],
    from: string,
    to: string,
  ): Promise<string[]> {
    if (slpCodes.length === 0) return [];
    const rows = await this.revenueRepo
      .createQueryBuilder('r')
      .select('DISTINCT r.stat_date', 'stat_date')
      .where('r.slp_code IN (:...slp)', { slp: [...new Set(slpCodes)] })
      .andWhere('r.stat_date >= :from', { from })
      .andWhere('r.stat_date <= :to', { to })
      .andWhere('r.is_provisional = 1')
      .getRawMany<{ stat_date: string | Date }>();
    return rows
      .map((row) =>
        row.stat_date instanceof Date
          ? row.stat_date.toISOString().slice(0, 10)
          : String(row.stat_date).slice(0, 10),
      )
      .sort();
  }

  // ------------------------------------------------------- dữ liệu chấm

  /** Tra override theo tháng; báo cáo lấy override của tháng nằm trong cửa sổ. */
  private findOverride(
    overrides: Map<string, KpiCriterionOverride>,
    saleId: number,
    customerId: number,
    criterionKey: string,
    months: string[],
  ): KpiCriterionOverride | undefined {
    for (const month of months) {
      const found = overrides.get(
        `${saleId}|${customerId}|${criterionKey}|${month}`,
      );
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Ghi đè 1 ô KHÁCH: ép về "chưa đạt". `force` = ghi đè cấp sale (ép kể cả
   * khi engine đã fail). Chỉ HẠ — trả true khi thực sự đổi kết quả (để trừ
   * vào x/y đầu bảng cấp sale).
   */
  private applyCustomerOverride(
    criterion: CustomerCriterion,
    override: KpiCriterionOverride | undefined,
    force = false,
  ): boolean {
    if (!override) return false;
    if (!force && criterion.status === 'fail') return false;
    const changed = criterion.status !== 'fail';
    criterion.status = 'fail';
    criterion.actualValue = 0;
    if (changed) {
      criterion.overridden = true;
      criterion.overrideReason = override.reason;
    }
    return changed;
  }

  /** Ghi đè CẢ TIÊU CHÍ của sale: đầu bảng về "Không đạt (ghi đè)", x = 0. */
  private applySaleOverride(
    criterion: SaleCriterion,
    override: KpiCriterionOverride | undefined,
  ): void {
    if (!override) return;
    const changed = criterion.status !== 'fail';
    criterion.status = 'fail';
    criterion.numerator = 0;
    criterion.passedCriteria = 0;
    if (changed) {
      criterion.overridden = true;
      criterion.overrideReason = override.reason;
    }
  }

  private buildScoredData(
    assignments: AssignmentRow[],
    activity: Map<number, ActivityDayRow[]>,
    targets: Map<string, number>,
    definitions: KpiDefinition[],
    saleInfos: Map<
      number,
      {
        fullName: string;
        zaloLinked: boolean;
        employeeCode: string | null;
        departments: { slug: string; name: string }[];
      }
    >,
    fromDate: string,
    months: string[],
    debtBalances: Map<number, number | null>,
    overrides: Map<string, KpiCriterionOverride>,
    revenue?: {
      byAssignment: Map<number, CustomerRevenueAmount>;
      bySale: Map<number, RevenueCustomerInput[]>;
      /** Chỉ tiêu quý của từng sale (null = chưa đồng bộ được). */
      quarterTargetBySale: Map<number, number | null>;
      quarter: FiscalQuarter | null;
      /** Sale chưa tra được mã nhân viên NKM. */
      salesWithoutMapping: Set<number>;
    },
  ) {
    const customersBySale = new Map<number, AssignmentRow[]>();
    for (const row of assignments) {
      const list = customersBySale.get(row.saleId) ?? [];
      list.push(row);
      customersBySale.set(row.saleId, list);
    }

    const scored = new Map<
      number,
      {
        saleName: string;
        zaloLinked: boolean;
        employeeCode: string | null;
        departments: { slug: string; name: string }[];
        criteria: SaleCriterion[];
        customers: {
          row: AssignmentRow;
          zaloLinked: boolean;
          tierSummary: CustomerTierSummary;
          criteria: CustomerCriterion[];
          totals: {
            inbound: number;
            outbound: number;
            orders: number;
            revenue: number;
          };
          /** 'has_revenue' khi khách có phát sinh NKM trong kỳ (≥1 phiếu). */
          revenueStatus: 'has_revenue' | 'no_revenue' | 'no_data';
        }[];
      }
    >();

    for (const [saleId, saleCustomers] of customersBySale) {
      const saleInfo = saleInfos.get(saleId);
      const saleCriteria: SaleCriterion[] = [];
      const customerRows: {
        row: AssignmentRow;
        zaloLinked: boolean;
        tierSummary: CustomerTierSummary;
        criteria: CustomerCriterion[];
        totals: {
          inbound: number;
          outbound: number;
          /** Đơn luồng Zalo (rollup ghi). */
          orders: number;
          revenue: number;
          /** Số phiếu NKM — cùng nguồn với revenue, xem chú thích ở chỗ push. */
          nkmQuantity: number;
        };
        revenueStatus: 'has_revenue' | 'no_revenue' | 'no_data';
      }[] = [];
      const revenueCustomers = revenue?.bySale.get(saleId) ?? [];
      const revenueFor = (row: AssignmentRow) => {
        // Sale chưa tra được mã nhân viên NKM → KHÔNG chấm doanh số cho khách
        // (no_data), khác với "khách không mua gì" (fail) — cùng luật với
        // salesWithoutMapping cấp sale bên dưới.
        if (revenue && revenue.salesWithoutMapping.has(row.saleId)) {
          return undefined;
        }
        const found = revenue?.byAssignment.get(row.assignmentId);
        return {
          tier: row.customerTier,
          quantity: found?.quantity ?? 0,
          lineTotal: found?.lineTotal ?? 0,
        };
      };

      for (const definition of definitions) {
        const perCustomer = saleCustomers.map((row) => {
          const days = activity.get(row.assignmentId) ?? [];
          const customerTarget = this.scoring.resolveCustomerTarget(
            definition,
            targets.get(`${saleId}|${row.customerId}|${definition.key}`) ??
              null,
            targets.get(`${saleId}|0|${definition.key}`) ?? null,
          );
          return {
            row,
            days,
            targetValue: customerTarget,
            debtBalance: debtBalances.get(row.customerId) ?? null,
            criterion: this.scoring.scoreCustomer(
              definition,
              days,
              customerTarget,
              fromDate,
              debtBalances.get(row.customerId) ?? null,
              revenueData(revenue, revenueFor(row)),
            ),
          };
        });

        const customerTargets = perCustomer
          .map((c) =>
            targets.get(`${saleId}|${c.row.customerId}|${definition.key}`),
          )
          .filter((value): value is number => value !== undefined)
          .map(Number);
        const saleTarget = this.scoring.resolveSaleTarget(
          definition,
          customerTargets,
          targets.get(`${saleId}|0|${definition.key}`) ?? null,
        );

        saleCriteria.push(
          this.scoring.scoreSale(
            definition,
            perCustomer.map((c) => ({
              days: c.days,
              targetValue: c.targetValue,
              debtBalance: c.debtBalance,
            })),
            saleTarget,
            saleInfo?.zaloLinked ?? false,
            fromDate,
            // Tiêu chí doanh số cần doanh thu từng khách + chỉ tiêu quý; các
            // tiêu chí khác bỏ qua tham số này.
            revenue
              ? {
                  quarter: revenue.quarter,
                  quarterTarget:
                    revenue.quarterTargetBySale.get(saleId) ?? null,
                  customers: revenueCustomers,
                  // Chưa tra được mã nhân viên NKM → no_data kèm lý do đúng,
                  // KHÔNG phải "sale không bán được gì"
                  mapped: !revenue.salesWithoutMapping.has(saleId),
                }
              : undefined,
          ),
        );

        // ── Ghi đè thủ công (trưởng phòng cùng phòng / admin) ──
        // Ghi đè cả sale mạnh nhất: cả tiêu chí tháng đó không đạt cho mọi khách.
        const saleOverride = this.findOverride(
          overrides,
          saleId,
          0,
          definition.key,
          months,
        );
        if (saleOverride) {
          this.applySaleOverride(
            saleCriteria[saleCriteria.length - 1],
            saleOverride,
          );
          for (const pc of perCustomer) {
            this.applyCustomerOverride(pc.criterion, saleOverride, true);
          }
        } else {
          let demoted = 0;
          for (const pc of perCustomer) {
            const customerOverride = this.findOverride(
              overrides,
              saleId,
              pc.row.customerId,
              definition.key,
              months,
            );
            if (this.applyCustomerOverride(pc.criterion, customerOverride)) {
              demoted += 1;
            }
          }
          if (demoted > 0) {
            // Ghi đè từng khách trừ vào x/y — đầu bảng tự khớp với bảng dưới
            const criterion = saleCriteria[saleCriteria.length - 1];
            criterion.passedCriteria = Math.max(
              0,
              (criterion.passedCriteria ?? 0) - demoted,
            );
            criterion.numerator = criterion.passedCriteria;
            criterion.status = criterion.passedCriteria > 0 ? 'pass' : 'fail';
          }
        }
      }

      for (const row of saleCustomers) {
        const days = activity.get(row.assignmentId) ?? [];
        // Doanh số NKM của khách trong kỳ — cùng nguồn với tiêu chí doanh số.
        // customer_activity_daily.revenue là rollup của hệ thống cũ (luôn 0) nên
        // totals.revenue phải lấy từ customer_revenue_daily đã nạp sẵn ở trên.
        const revenueRow = revenueFor(row);
        const criteria = definitions.map((definition) => {
          const customerTarget = this.scoring.resolveCustomerTarget(
            definition,
            targets.get(`${saleId}|${row.customerId}|${definition.key}`) ??
              null,
            targets.get(`${saleId}|0|${definition.key}`) ?? null,
          );
          const criterion = this.scoring.scoreCustomer(
            definition,
            days,
            customerTarget,
            fromDate,
            debtBalances.get(row.customerId) ?? null,
            revenueData(revenue, revenueRow),
          );
          // Cùng luật ghi đè với vòng chấm cấp sale: ghi đè cả sale ép mọi ô
          // khách, ghi đè từng khách chỉ hạ ô của khách đó
          const saleOverride = this.findOverride(
            overrides,
            saleId,
            0,
            definition.key,
            months,
          );
          this.applyCustomerOverride(
            criterion,
            saleOverride ??
              this.findOverride(
                overrides,
                saleId,
                row.customerId,
                definition.key,
                months,
              ),
            Boolean(saleOverride),
          );
          return criterion;
        });
        const latest = days[days.length - 1];
        customerRows.push({
          row,
          zaloLinked: Boolean(latest?.zalo_linked),
          // KEY/NON: khách KEY phải đạt cả 4 tiêu chí, khách NON chỉ đếm x/4
          tierSummary: this.scoring.summarizeCustomerByTier(
            criteria,
            row.customerTier,
          ),
          criteria,
          totals: {
            ...days.reduce(
              (acc, day) => ({
                inbound: acc.inbound + day.inbound_count,
                outbound: acc.outbound + day.outbound_count,
                orders: acc.orders + day.order_count,
                revenue: acc.revenue + day.revenue,
              }),
              { inbound: 0, outbound: 0, orders: 0, revenue: 0 },
            ),
            // Doanh số thật theo đồng bộ NKM — xem ghi chú revenueRow đầu vòng
            revenue: revenueRow?.lineTotal ?? 0,
            // Số phiếu NKM (mua qua SAP) — CÙNG nguồn với revenue ở trên.
            // KHÁC totals.orders (đơn của luồng Zalo do rollup ghi): khách chỉ
            // mua qua SAP có revenue > 0 nhưng orders = 0 — hai cột bổ sung
            // cho nhau, không loại trừ nhau (chốt cách B 16/10/2026).
            nkmQuantity: revenueRow?.quantity ?? 0,
          },
          // FE cột "Doanh số" đọc trạng thái này: có phát sinh = ≥1 phiếu trong
          // kỳ; no_data = sale chưa tra được mã NKM (KHÔNG kết luận trượt).
          revenueStatus: !revenueRow
            ? 'no_data'
            : revenueRow.quantity > 0
              ? 'has_revenue'
              : 'no_revenue',
        });
      }

      scored.set(saleId, {
        saleName: saleInfo?.fullName ?? `Sale #${saleId}`,
        zaloLinked: saleInfo?.zaloLinked ?? false,
        employeeCode: saleInfo?.employeeCode ?? null,
        departments: saleInfo?.departments ?? [],
        criteria: saleCriteria,
        customers: customerRows,
      });
    }

    return scored;
  }

  // ------------------------------------------------------------- API

  /**
   * Pipeline dùng chung cho overview / by-sale / export: nạp phân công +
   * hoạt động (kèm lookback cho bài toán gợi ý) + doanh thu API NKM + chỉ tiêu
   * rồi chấm điểm. Map rỗng = người dùng không thấy sale nào trong phạm vi.
   *
   * `loadDebt` = buộc nạp công nợ dù không có tiêu chí `debt_balance` (khi
   * người dùng lọc/sắp xếp theo công nợ). Trả luôn công nợ đã nạp + ngày có
   * tin đi gần nhất để by-sale dựng bộ lọc mà không cần query lại, và trả
   * `definitions` để overview kiểm tra mã tiêu chí truyền vào.
   *
   * Doanh thu chỉ nạp khi có tiêu chí doanh số đang bật — báo cáo không dùng tới
   * thì khỏi tốn 2 query và khỏi phụ thuộc bảng tra NKM đã nạp hay chưa.
   */
  private async buildScoredFor(
    saleId: number | undefined,
    from: string,
    to: string,
    user: any,
    quarter: FiscalQuarter | null,
    options: { loadDebt?: boolean } = {},
  ) {
    const userIds = await this.scopeUserIds(user);
    const definitions = await this.loadDefinitions();
    if (userIds !== undefined && userIds.length === 0) {
      return {
        scored: new Map(),
        definitions,
        debtBalances: new Map<number, number | null>(),
        lastOutboundByAssignment: new Map<number, string | null>(),
        provisionalDates: [] as string[],
      };
    }
    if (saleId !== undefined) {
      this.assertSaleInScope(saleId, userIds);
    }
    const lookbackFrom = this.shiftDate(from, -SUGGESTION_GAP_DAYS);
    const assignments = await this.loadAssignments(userIds, saleId);
    const saleIds = assignments.map((row) => row.saleId);
    const activity = await this.loadActivity(
      assignments.map((row) => row.assignmentId),
      lookbackFrom,
      to,
    );
    const months = this.monthsInRange(from, to);
    // Sự kiện báo cáo di chuyển (tiêu chí 3) ghép thẳng vào map ngày hoạt động
    this.mergeMovementReports(
      activity,
      assignments,
      await this.loadMovementEvents(saleIds, from, to),
    );
    const criterionKeys = definitions.map((definition) => definition.key);
    const targets = await this.loadTargets(saleIds, criterionKeys, months);
    const overrides = await this.loadOverrides(saleIds, criterionKeys, months);
    const saleInfos = await this.loadSaleInfos([...new Set(saleIds)]);
    // Chỉ nạp công nợ khi có tiêu chí dùng metric debt_balance hoặc khi người
    // dùng lọc/sắp xếp theo công nợ — tránh 1 query thừa cho mọi lần tải
    const debtBalances =
      options.loadDebt ||
      definitions.some((definition) => definition.metric === 'debt_balance')
        ? await this.loadDebtBalances(assignments)
        : new Map<number, number | null>();

    const revenue = await this.loadRevenueForReport(
      assignments,
      saleInfos,
      definitions,
      from,
      to,
      quarter,
    );

    return {
      scored: this.buildScoredData(
        assignments,
        activity,
        targets,
        definitions,
        saleInfos,
        from,
        months,
        debtBalances,
        overrides,
        revenue,
      ),
      definitions,
      debtBalances,
      revenue,
      lastOutboundByAssignment: this.lastOutboundByAssignment(activity),
    };
  }

  /**
   * Nạp doanh thu + chỉ tiêu quý cho báo cáo. Trả `undefined` khi không có tiêu
   * chí doanh số đang bật (đỡ query thừa) hoặc khi bảng tra mã còn trống.
   */
  private async loadRevenueForReport(
    assignments: AssignmentRow[],
    saleInfos: Map<number, { employeeCode: string | null }>,
    definitions: KpiDefinition[],
    from: string,
    to: string,
    quarter: FiscalQuarter | null,
  ) {
    const revenueDefinitions = definitions.filter((definition) =>
      REVENUE_METRICS.includes(definition.metric),
    );
    if (revenueDefinitions.length === 0) return undefined;

    const loaded = await this.loadRevenue(assignments, saleInfos, from, to);
    // Chỉ tiêu quý theo TỪNG SALE: ngược dòng bảng tra mã để ra slp_code rồi
    // tra bảng chỉ tiêu. Một sale có nhiều slpCode thì lấy tổng (hiếm, nhưng
    // đúng hơn là bỏ mất).
    const saleMap = await this.saleMapRepo.find({
      where: { is_active: true },
      select: ['slp_code', 'employee_code'],
    });
    const slpByEmployeeCode = new Map<string, number[]>();
    for (const row of saleMap) {
      const list = slpByEmployeeCode.get(row.employee_code) ?? [];
      list.push(row.slp_code);
      slpByEmployeeCode.set(row.employee_code, list);
    }
    const quarterTargetBySale = new Map<number, number | null>();
    const slpCodesOfSale = new Map<number, number[]>();
    for (const saleId of new Set(assignments.map((row) => row.saleId))) {
      const employeeCode = saleInfos.get(saleId)?.employeeCode ?? null;
      const codes = employeeCode
        ? (slpByEmployeeCode.get(employeeCode) ?? [])
        : [];
      slpCodesOfSale.set(saleId, codes);
      quarterTargetBySale.set(saleId, null);
    }
    if (quarter) {
      const targets = await this.loadQuarterTargets(
        [...slpCodesOfSale.values()].flat(),
        quarter,
      );
      for (const [saleId, codes] of slpCodesOfSale) {
        let total = 0;
        let found = false;
        for (const slp of codes) {
          if (targets.has(slp)) {
            total += targets.get(slp) as number;
            found = true;
          }
        }
        quarterTargetBySale.set(saleId, found ? total : null);
      }
    }

    const provisionalDates = await this.loadProvisionalDates(
      [...slpCodesOfSale.values()].flat(),
      from,
      to,
    );
    return {
      ...loaded,
      quarterTargetBySale,
      quarter,
      provisionalDates,
    };
  }

  /** Ngày gần nhất có tin SALE gửi đi, theo assignmentId (`null` = chưa có). */ private lastOutboundByAssignment(
    activity: Map<number, ActivityDayRow[]>,
  ): Map<number, string | null> {
    const result = new Map<number, string | null>();
    for (const [assignmentId, days] of activity) {
      result.set(
        assignmentId,
        this.lastDayWhere(days, (day) => day.outbound_count > 0),
      );
    }
    return result;
  }

  async overview(query: any, user: any) {
    const window = this.resolveWindow(query);
    const { scored, definitions, revenue } = await this.buildScoredFor(
      query.saleId,
      window.from,
      window.to,
      user,
      window.quarter,
    );

    // search = lọc theo TÊN SALE (dataset là các sale trong phạm vi — khách
    // hàng không nằm trong response của overview)
    const search = String(query.search ?? '')
      .trim()
      .toLowerCase();
    const filters = this.parseOverviewFilters(query);

    // Tập sale đang xem = trong phạm vi (hoặc đúng `saleId`) và khớp `search`.
    // Cả `summary`, `groups` lẫn `company` đều tính trên tập này.
    const inView = [...scored.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(
        ([, data]) => !search || data.saleName.toLowerCase().includes(search),
      )
      .map(([saleId, data]) => ({
        saleId,
        saleName: data.saleName,
        zaloLinked: data.zaloLinked,
        employeeCode: data.employeeCode,
        departments: data.departments,
        criteria: data.criteria,
        revenue: this.saleRevenueRow(data),
      }));

    this.assertOverviewFilters(filters, definitions);

    // summary tính TRƯỚC bộ lọc tiêu chí: "tiêu chí này bao nhiêu sale đạt /
    // không đạt" không nhảy số khi bật lọc — cùng nguyên tắc đầu bảng
    // `criteria` của by-sale (tổng hợp luôn trên tập đầy đủ). `groups` và
    // `company` cũng tính trên tập đầy đủ vì đây là số liệu tổng quan.
    const summary = summarizeKpiSales(inView.map((sale) => sale.criteria));
    const { groups, company } = await this.rollupGroups(inView, window);

    return {
      from: window.from,
      to: window.to,
      quarter: window.quarter,
      isWholeQuarter: window.isWholeQuarter,
      // Ngày chưa chốt (hôm nay) — FE hiện kèm nhãn "tạm tính"
      provisionalDates: revenue?.provisionalDates ?? [],
      summary,
      sales: filterKpiSales(inView, filters),
      groups,
      company,
    };
  }

  /**
   * Dòng phân phối của MỘT sale — số liệu FE vẽ bảng phân phối (pivot) của lead:
   * Key x/y, Non x/y, Dso, tỷ lệ, % đạt, kết luận.
   *
   * Thiếu dữ liệu đồng bộ (chưa nạp bảng tra mã / chưa chạy job) thì các cột
   * tiền là `null` kèm `reason` ở tiêu chí tương ứng, KHÔNG phải 0 — tránh FE
   * hiểu nhầm "sale không bán được gì".
   */
  private saleRevenueRow(entry: {
    criteria: SaleCriterion[];
    customers: {
      row: AssignmentRow;
      tierSummary: CustomerTierSummary;
    }[];
  }): SaleRevenueRow {
    const tierOf = (row: { row: AssignmentRow }) =>
      (row.row.customerTier ?? '').toUpperCase();
    const keyRows = entry.customers.filter((row) => tierOf(row) === 'KEY');
    const nonRows = entry.customers.filter((row) => tierOf(row) === 'NON');
    const detail =
      entry.criteria.find((criterion) => criterion.revenue)?.revenue ?? null;
    return {
      keyCustomers: detail?.keyCustomers ?? {
        reached: 0,
        total: keyRows.length,
      },
      nonCustomers: detail?.nonCustomers ?? {
        reached: 0,
        total: nonRows.length,
      },
      dsoKey: detail?.dsoKey ?? null,
      dsoNon: detail?.dsoNon ?? null,
      keyShareRatio: detail?.keyShareRatio ?? null,
      quarterTarget: detail?.quarterTarget ?? null,
      achievedRatio: detail?.achievedRatio ?? null,
      achievedPct: detail?.achievedPct ?? null,
      verdict: detail?.verdict ?? null,
      // "x/y khách KEY đạt toàn bộ tiêu chí" + trung bình tiêu chí khách NON
      keyFullyPassed: {
        passed: keyRows.filter((row) => row.tierSummary.verdict === 'pass')
          .length,
        total: keyRows.length,
      },
      nonCriteria: {
        passed: nonRows.reduce((acc, row) => acc + row.tierSummary.passed, 0),
        applicable: nonRows.reduce(
          (acc, row) => acc + row.tierSummary.applicable,
          0,
        ),
        customers: nonRows.length,
      },
    };
  }

  /**
   * Báo cáo 3 cấp: `groups` = mỗi phòng kinh doanh một hàng tổng, `company` =
   * hàng tổng công ty. Phạm vi tự nhiên đã đúng 3 cấp qua `scopeUserIds`
   * (sale = mình, trưởng phòng = phòng mình, admin/pm = cả công ty) nên QL Nhóm
   * chỉ nhận đúng nhóm của mình trong `groups`.
   *
   * Chỉ tiêu cấp nhóm: có dòng trong `dept_revenue_target` thì dùng dòng đó,
   * không thì TỔNG chỉ tiêu quý của các sale trong nhóm (API quý chỉ có target
   * theo sale — xem thiết kế §6.3).
   */
  private async rollupGroups(
    rows: {
      saleId: number;
      revenue: SaleRevenueRow;
      departments: { slug: string; name: string }[];
    }[],
    window: KpiWindow,
  ): Promise<{
    groups: (SaleRevenueRow & {
      slug: string | null;
      name: string;
      salesCount: number;
    })[];
    company: SaleRevenueRow;
  }> {
    const byDept = new Map<
      string,
      {
        slug: string | null;
        name: string;
        salesCount: number;
        rows: SaleRevenueRow[];
      }
    >();
    for (const row of rows) {
      const dept = row.departments[0];
      const slug = dept?.slug ?? null;
      const key = slug ?? '(chua-xac-dinh)';
      const bucket = byDept.get(key) ?? {
        slug,
        name: dept?.name ?? 'Chưa xác định phòng',
        salesCount: 0,
        rows: [],
      };
      bucket.salesCount += 1;
      bucket.rows.push(row.revenue);
      byDept.set(key, bucket);
    }

    const deptTargets = window.quarter
      ? await this.loadDeptTargets(
          [...byDept.values()]
            .map((bucket) => bucket.slug)
            .filter((slug): slug is string => slug != null),
          window.quarter,
        )
      : new Map<string, number>();

    const groups = [...byDept.values()]
      .sort((a, b) => (a.slug ?? 'zzz').localeCompare(b.slug ?? 'zzz'))
      .map((bucket) => {
        const rollup = this.rollupRevenueRows(bucket.rows);
        // Không có target nhóm nhập tay → tổng target quý của các sale trong nhóm
        const target =
          bucket.slug != null && deptTargets.has(bucket.slug)
            ? (deptTargets.get(bucket.slug) as number)
            : bucket.rows.reduce(
                (acc, row) => acc + (row.quarterTarget ?? 0),
                0,
              );
        const revenue = (rollup.dsoKey ?? 0) + (rollup.dsoNon ?? 0);
        const achievedRatio =
          target > 0 && window.quarter ? roundTo(revenue / target, 4) : null;
        const verdict: SaleRevenueRow['verdict'] =
          achievedRatio === null ? null : achievedRatio >= 1 ? 'pass' : 'fail';
        return {
          slug: bucket.slug,
          name: bucket.name,
          salesCount: bucket.salesCount,
          ...rollup,
          quarterTarget: target,
          achievedRatio,
          achievedPct:
            achievedRatio === null ? null : roundTo(achievedRatio * 100, 2),
          verdict,
        };
      });

    const company: SaleRevenueRow = {
      ...this.rollupRevenueRows(rows.map((row) => row.revenue)),
      quarterTarget: rows.reduce(
        (acc, row) => acc + (row.revenue.quarterTarget ?? 0),
        0,
      ),
      achievedRatio: null,
      achievedPct: null,
      verdict: null,
    };
    const companyRevenue = (company.dsoKey ?? 0) + (company.dsoNon ?? 0);
    if (
      window.quarter &&
      company.quarterTarget != null &&
      company.quarterTarget > 0
    ) {
      company.achievedRatio = roundTo(
        companyRevenue / company.quarterTarget,
        4,
      );
      company.achievedPct = roundTo(company.achievedRatio * 100, 2);
      company.verdict = company.achievedRatio >= 1 ? 'pass' : 'fail';
    }
    return { groups, company };
  }

  /** Cộng dồn các dòng phân phối (sale → nhóm, nhóm → công ty). */
  private rollupRevenueRows(rows: SaleRevenueRow[]): SaleRevenueRow {
    const dsoKey = rows.reduce((acc, row) => acc + (row.dsoKey ?? 0), 0);
    const dsoNon = rows.reduce((acc, row) => acc + (row.dsoNon ?? 0), 0);
    const total = dsoKey + dsoNon;
    return {
      keyCustomers: {
        reached: rows.reduce((acc, row) => acc + row.keyCustomers.reached, 0),
        total: rows.reduce((acc, row) => acc + row.keyCustomers.total, 0),
      },
      nonCustomers: {
        reached: rows.reduce((acc, row) => acc + row.nonCustomers.reached, 0),
        total: rows.reduce((acc, row) => acc + row.nonCustomers.total, 0),
      },
      dsoKey,
      dsoNon,
      keyShareRatio: total > 0 ? roundTo(dsoKey / total, 4) : null,
      quarterTarget: null,
      achievedRatio: null,
      achievedPct: null,
      verdict: null,
      keyFullyPassed: rows.some((row) => row.keyFullyPassed)
        ? {
            passed: rows.reduce(
              (acc, row) => acc + (row.keyFullyPassed?.passed ?? 0),
              0,
            ),
            total: rows.reduce(
              (acc, row) => acc + (row.keyFullyPassed?.total ?? 0),
              0,
            ),
          }
        : null,
      nonCriteria: rows.some((row) => row.nonCriteria)
        ? {
            passed: rows.reduce(
              (acc, row) => acc + (row.nonCriteria?.passed ?? 0),
              0,
            ),
            applicable: rows.reduce(
              (acc, row) => acc + (row.nonCriteria?.applicable ?? 0),
              0,
            ),
            customers: rows.reduce(
              (acc, row) => acc + (row.nonCriteria?.customers ?? 0),
              0,
            ),
          }
        : null,
    };
  }

  async bySale(query: any, user: any) {
    // Bảng khách hàng của MỘT sale — không cho quét toàn công ty trong một call
    // (9.8k khách × tiêu chí sẽ là payload hàng chục MB nếu thiếu saleId)
    if (query.saleId === undefined) {
      throw new BadRequestException(
        'by-sale bắt buộc truyền saleId (bảng khách hàng của một sale)',
      );
    }
    // `met` là bộ lọc cấp SALE của overview — im lặng bỏ qua sẽ khiến FE
    // tưởng đã lọc
    if (query.met !== undefined) {
      throw new BadRequestException(
        'by-sale không lọc theo met (đạt/không đạt) — dùng status hoặc minRatio',
      );
    }
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 100));
    const filters = this.parseCustomerFilters(query);
    // Công nợ chỉ nạp khi bộ lọc/sắp xếp cần — chấm điểm tự lo phần còn lại
    const needsDebt =
      filters.minDebt !== undefined ||
      filters.hasDebt !== undefined ||
      filters.sortBy === 'debtBalance';
    const window = this.resolveWindow(query);
    const { scored, debtBalances, lastOutboundByAssignment, revenue } =
      await this.buildScoredFor(
        query.saleId,
        window.from,
        window.to,
        user,
        window.quarter,
        {
          loadDebt: needsDebt,
        },
      );

    const entry = scored.get(query.saleId);
    if (!entry) {
      return {
        from: window.from,
        to: window.to,
        quarter: window.quarter,
        isWholeQuarter: window.isWholeQuarter,
        provisionalDates: revenue?.provisionalDates ?? [],
        page,
        pageSize,
        total: 0,
        sales: [],
      };
    }

    // Bộ lọc/sắp xếp theo tiêu chí phải trúng tiêu chí ĐANG BẬT — mã sai hoặc
    // khoanh một tiêu chí mà không kèm điều kiện thì báo lỗi ngay thay vì im
    // lặng trả bảng rỗng.
    const criterionKeys = entry.criteria.map((criterion) => criterion.key);
    this.assertCriterionFilters(filters, criterionKeys);
    this.assertSortKey(filters.sortBy, criterionKeys);

    // Không có tin đi trong toàn bộ cửa sổ → coi như ít nhất bằng độ dài cửa
    // sổ; cần số (không dùng null) để sắp xếp không phải đoán "thiếu dữ liệu".
    const daysSinceContact = new Map<number, number>();
    for (const [assignmentId, lastOutbound] of lastOutboundByAssignment) {
      daysSinceContact.set(
        assignmentId,
        lastOutbound
          ? this.diffDays(lastOutbound, window.to)
          : Number.MAX_SAFE_INTEGER,
      );
    }

    // Chấm điểm vẫn tính trên TOÀN BỘ khách của sale — lọc/sắp xếp chỉ tác
    // động tới danh sách hiển thị, đầu bảng `criteria` giữ nguyên số liệu đầy đủ
    const matched = sortKpiCustomers(
      filterKpiCustomers(entry.customers, filters, {
        daysSinceContact,
        debtBalances,
      }),
      filters.sortBy,
      filters.sortOrder,
      { daysSinceContact, debtBalances },
    );
    const total = matched.length;
    const paged = matched
      .slice((page - 1) * pageSize, page * pageSize)
      .map((customer) => ({
        assignmentId: customer.row.assignmentId,
        customerId: customer.row.customerId,
        customerCode: customer.row.customerCode,
        customerName: customer.row.customerName,
        customerTier: customer.row.customerTier,
        customerRole: customer.row.customerRole,
        zaloLinked: customer.zaloLinked,
        // Kết luận theo loại khách: KEY = đạt cả 4 tiêu chí, NON = đếm x/4
        tierSummary: customer.tierSummary,
        totals: customer.totals,
        criteria: customer.criteria,
        // 'has_revenue' khi khách có phát sinh NKM trong kỳ (≥1 phiếu)
        revenueStatus: customer.revenueStatus,
      }));

    return {
      from: window.from,
      to: window.to,
      quarter: window.quarter,
      isWholeQuarter: window.isWholeQuarter,
      provisionalDates: revenue?.provisionalDates ?? [],
      page,
      pageSize,
      total,
      sales: [
        {
          saleId: query.saleId,
          saleName: entry.saleName,
          zaloLinked: entry.zaloLinked,
          criteria: entry.criteria,
          revenue: this.saleRevenueRow(entry),
          customers: paged,
        },
      ],
    };
  }

  /**
   * Chuẩn hoá query thành bộ lọc. Kiểu dữ liệu + enum đã do `KpiBySaleQueryDto`
   * kiểm tra trước khi tới đây, nên ở đây chỉ gạt chuỗi rỗng và ép kiểu; giá
   * trị lạ bị ValidationPipe chặn từ nhánh controller.
   */
  private parseCustomerFilters(query: any): KpiCustomerFilters {
    const text = this.queryText;
    const numeric = this.queryNumber;
    const boolean = this.queryBoolean;
    const order = query.sortOrder;
    return {
      tier: text(query.tier),
      role: text(query.role),
      department: text(query.department),
      zaloStatus: text(query.zaloStatus) as KpiCustomerFilters['zaloStatus'],
      sapCode: text(query.sapCode),
      search: text(query.search),
      criterionKey: text(query.criterionKey),
      status: text(query.status) as KpiCriterionStatus | undefined,
      minRatio: numeric(query.minRatio),
      hasOrders: boolean(query.hasOrders),
      minOrders: numeric(query.minOrders),
      minRevenue: numeric(query.minRevenue),
      minInbound: numeric(query.minInbound),
      minOutbound: numeric(query.minOutbound),
      daysSinceContact: numeric(query.daysSinceContact),
      minDebt: numeric(query.minDebt),
      hasDebt: boolean(query.hasDebt),
      sortBy: text(query.sortBy),
      sortOrder: order === 'asc' || order === 'desc' ? order : undefined,
    };
  }

  /** Chuẩn hoá query của overview — chỉ có nhóm lọc theo tiêu chí. */
  private parseOverviewFilters(query: any): KpiSaleFilters {
    const text = this.queryText;
    const numeric = this.queryNumber;
    const boolean = this.queryBoolean;
    return {
      criterionKey: text(query.criterionKey),
      met: boolean(query.met),
      minRatio: numeric(query.minRatio),
      status: text(query.status) as KpiSaleFilters['status'],
    };
  }

  private queryText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private queryNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private queryBoolean(value: unknown): boolean | undefined {
    return value === 'true' ? true : value === 'false' ? false : undefined;
  }

  /**
   * Kiểm tra bộ lọc theo tiêu chí ở CẤP SALE trước khi chạy: mã tiêu chí sai,
   * khoanh tiêu chí mà không kèm điều kiện, hoặc xin pass/fail của tiêu chí
   * ratio đều báo lỗi ngay thay vì trả danh sách rỗng im lặng.
   */
  private assertOverviewFilters(
    filters: KpiSaleFilters,
    definitions: KpiDefinition[],
  ) {
    const activeKeys = definitions.map((definition) => definition.key);
    if (filters.criterionKey && !activeKeys.includes(filters.criterionKey)) {
      throw new BadRequestException(
        `Không có tiêu chí "${filters.criterionKey}". Tiêu chí đang bật: ${activeKeys.join(', ') || '(chưa có)'}`,
      );
    }
    if (
      filters.criterionKey &&
      filters.status === undefined &&
      filters.minRatio === undefined &&
      filters.met === undefined
    ) {
      throw new BadRequestException(
        'criterionKey cần kèm met, minRatio hoặc status — một mình nó không lọc gì',
      );
    }
    if (filters.met !== undefined && !filters.criterionKey) {
      throw new BadRequestException(
        'met cần kèm criterionKey — đạt/không đạt luôn gắn với một tiêu chí cụ thể',
      );
    }
    if (filters.status === 'ratio') {
      // Tiêu chí ratio ở cấp sale luôn trả status 'ratio' nên lọc theo nó
      // không bỏ được sale nào — dùng minRatio hoặc met mới nói lên được mức độ
      throw new BadRequestException(
        'status=ratio không lọc được gì ở cấp sale — dùng minRatio hoặc met',
      );
    }
    if (filters.status === 'pass' || filters.status === 'fail') {
      const definition = filters.criterionKey
        ? definitions.find((d) => d.key === filters.criterionKey)
        : undefined;
      if (definition) {
        // Tiêu chí doanh số là ratio trong cấu hình NHƯNG cấp sale vẫn kết luận
        // được đạt/không đạt (% đạt so chỉ tiêu quý) nên vẫn lọc được.
        const hasVerdict = REVENUE_METRICS.includes(definition.metric);
        if (definition.scoring_mode === ScoringMode.RATIO && !hasVerdict) {
          throw new BadRequestException(
            `Tiêu chí "${filters.criterionKey}" là ratio — ở cấp sale không có pass/fail. Dùng met hoặc minRatio`,
          );
        }
      } else if (
        !definitions.some(
          (d) =>
            d.scoring_mode === ScoringMode.BINARY ||
            REVENUE_METRICS.includes(d.metric),
        )
      ) {
        throw new BadRequestException(
          'status=pass/fail cần tiêu chí binary hoặc tiêu chí doanh số. Dùng minRatio hoặc met',
        );
      }
    }
  }

  private assertCriterionFilters(
    filters: KpiCustomerFilters,
    criterionKeys: string[],
  ) {
    if (filters.criterionKey && !criterionKeys.includes(filters.criterionKey)) {
      throw new BadRequestException(
        `Không có tiêu chí "${filters.criterionKey}". Tiêu chí đang bật: ${criterionKeys.join(', ') || '(chưa có)'}`,
      );
    }
    if (
      filters.criterionKey &&
      filters.status === undefined &&
      filters.minRatio === undefined
    ) {
      throw new BadRequestException(
        'criterionKey cần kèm status hoặc minRatio — một mình nó không lọc gì',
      );
    }
  }

  private assertSortKey(sortBy: string | undefined, criterionKeys: string[]) {
    if (!sortBy) return;
    if (
      !(KPI_SORT_KEYS as readonly string[]).includes(sortBy) &&
      !criterionKeys.includes(sortBy)
    ) {
      throw new BadRequestException(
        `sortBy không hợp lệ: "${sortBy}". Cột cố định: ${KPI_SORT_KEYS.join(', ')} — hoặc mã tiêu chí đang bật (${criterionKeys.join(', ') || 'chưa có'})`,
      );
    }
  }

  /**
   * Gợi ý thực hiện (mục 5.4) — tính lúc đọc từ customer_activity_daily,
   * dùng cùng quy tắc "bị bỏ bê" với tiêu chí goi_y_thuc_hien nên hai nơi
   * không bao giờ lệch nhau.
   */
  async suggestions(saleId: number | undefined, user: any) {
    const userIds = await this.scopeUserIds(user);
    return this.buildSuggestions(saleId, userIds);
  }

  /**
   * Gợi ý TOÀN CÔNG TY cho cron buổi sáng (CustomerSuggestionsCronjob) — chạy
   * ngoài phạm vi người dùng đăng nhập, dùng cùng pipeline với `suggestions`.
   */
  async suggestionsForAllSales() {
    return this.buildSuggestions(undefined, undefined);
  }

  private async buildSuggestions(
    saleId: number | undefined,
    userIds: number[] | undefined,
  ) {
    if (userIds !== undefined && userIds.length === 0) {
      return { date: this.today(), sales: [] };
    }
    if (saleId !== undefined) {
      this.assertSaleInScope(saleId, userIds);
    }
    const today = this.today();
    // cần 30 ngày để nhận biết "NON có đơn mới" + 7 ngày lookback
    const windowFrom = this.shiftDate(today, -30);
    const assignments = await this.loadAssignments(userIds, saleId);
    const activity = await this.loadActivity(
      assignments.map((row) => row.assignmentId),
      windowFrom,
      today,
    );
    const saleInfos = await this.loadSaleInfos([
      ...new Set(assignments.map((row) => row.saleId)),
    ]);

    const bySale = new Map<number, AssignmentRow[]>();
    for (const row of assignments) {
      const list = bySale.get(row.saleId) ?? [];
      list.push(row);
      bySale.set(row.saleId, list);
    }

    const sales = [...bySale.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([sale, rows]) => {
        const items = rows
          .map((row) => {
            const suggestion = this.suggestForCustomer(
              row,
              activity.get(row.assignmentId) ?? [],
              today,
            );
            return suggestion;
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .sort(
            (a, b) =>
              (SUGGESTION_REASON_PRIORITY[a.reason] ?? 99) -
              (SUGGESTION_REASON_PRIORITY[b.reason] ?? 99),
          )
          .slice(0, SUGGESTION_LIMIT_PER_SALE);
        return {
          saleId: sale,
          saleName: saleInfos.get(sale)?.fullName ?? `Sale #${sale}`,
          suggestions: items,
        };
      })
      .filter((entry) => entry.suggestions.length > 0);

    return { date: today, sales };
  }

  private suggestForCustomer(
    row: AssignmentRow,
    days: ActivityDayRow[],
    today: string,
  ) {
    const linked = days.filter((day) => day.zalo_linked);
    // khách chưa đo được dữ liệu Zalo nào → không gợi ý (đề xuất không gửi được)
    if (linked.length === 0) return null;
    const lastOutboundDay = this.lastDayWhere(
      days,
      (day) => day.outbound_count > 0,
    );
    const lastInboundDay = this.lastDayWhere(
      days,
      (day) => day.inbound_count > 0,
    );
    const lastOrderDay = this.lastDayWhere(days, (day) => day.order_count > 0);
    const daysSinceOutbound = lastOutboundDay
      ? this.diffDays(lastOutboundDay, today)
      : Number.POSITIVE_INFINITY;
    const daysSinceOrder = lastOrderDay
      ? this.diffDays(lastOrderDay, today)
      : Number.POSITIVE_INFINITY;

    // 1. Khách nhắn mà sale chưa trả lời (kể cả hôm qua) — khẩn nhất
    if (
      lastInboundDay &&
      this.diffDays(lastInboundDay, today) <= 3 &&
      (!lastOutboundDay || lastOutboundDay < lastInboundDay)
    ) {
      return this.suggestion(
        row,
        'chua_phan_hoi',
        lastInboundDay,
        lastOutboundDay,
      );
    }
    // 2. Khách KEY lâu không được liên lạc (mục 5.4)
    if (
      (row.customerTier ?? '').toUpperCase() === 'KEY' &&
      daysSinceOutbound >= SUGGESTION_GAP_DAYS
    ) {
      return this.suggestion(
        row,
        'key_chua_lien_lac',
        lastOutboundDay,
        lastOutboundDay,
      );
    }
    // 3. Khách NON có đơn gần đây nhưng bị bỏ bê
    if (
      (row.customerTier ?? '').toUpperCase() === 'NON' &&
      daysSinceOrder <= 30 &&
      daysSinceOutbound >= SUGGESTION_GAP_DAYS
    ) {
      return this.suggestion(
        row,
        'non_don_moi_chua_cham',
        lastOrderDay,
        lastOutboundDay,
      );
    }
    return null;
  }

  private suggestion(
    row: AssignmentRow,
    reason: string,
    contextDate: string | null,
    lastContactDate: string | null,
  ) {
    return {
      assignmentId: row.assignmentId,
      customerId: row.customerId,
      customerCode: row.customerCode,
      customerName: row.customerName,
      customerTier: row.customerTier,
      reason,
      reasonText: SUGGESTION_REASONS[reason] ?? reason,
      contextDate,
      lastContactDate,
    };
  }

  // ------------------------------------------------------------- export

  async exportReport(saleId: number | undefined, query: any, user: any) {
    const window = this.resolveWindow(query);
    // Dùng pipeline chung một lần duy nhất — export KHÔNG truyền saleId vẫn
    // được (toàn công ty) vì sheet CHI TIET được dựng từ dữ liệu đã chấm,
    // không đi qua by-sale (nơi bắt buộc saleId để giới hạn payload)
    const { scored } = await this.buildScoredFor(
      saleId,
      window.from,
      window.to,
      user,
      window.quarter,
    );
    const saleRows = [...scored.entries()].sort((a, b) => a[0] - b[0]);
    const { from, to } = window;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'saletracker';
    const summary = wb.addWorksheet('TONG KET');
    const criteriaNames = saleRows[0]?.[1].criteria.map((c) => c.name) ?? [];

    summary.addRow([
      `Báo cáo KPI khách hàng ${from} → ${to}${window.quarter ? ` (${window.quarter.label})` : ''}`,
    ]);
    summary.addRow([]);
    summary.addRow(['Sale', ...criteriaNames]);
    for (const [, data] of saleRows) {
      summary.addRow([
        data.saleName,
        ...data.criteria.map((c) => this.criterionCell(c)),
      ]);
    }

    // Sheet phân phối — đúng hình bảng pivot lead gửi: Key x/y, Non x/y, Dso Key,
    // Dso Non, Tỷ lệ (DS Key), target quý, % đạt, đạt/không đạt; kèm hàng tổng
    // từng phòng và hàng tổng công ty.
    const distSheet = wb.addWorksheet('PHAN PHOI');
    distSheet.addRow([
      'Cấp',
      'Đối tượng',
      'Key (phát sinh/tổng)',
      'Non (phát sinh/tổng)',
      'Dso Key',
      'Dso Non',
      'Tỷ lệ (DS Key)',
      'Chỉ tiêu quý',
      '% đạt',
      'Kết luận',
    ]);
    distSheet.addRow([]);
    distSheet.addRow(['SALE', 'Tất cả sale', '', '', '', '', '', '', '', '']);
    for (const [, data] of saleRows) {
      const row = this.saleRevenueRow(data);
      distSheet.addRow([
        'Sale',
        data.saleName,
        this.reachedText(row.keyCustomers),
        this.reachedText(row.nonCustomers),
        row.dsoKey,
        row.dsoNon,
        this.ratioText(row.keyShareRatio),
        row.quarterTarget,
        this.percentText(row.achievedPct),
        this.verdictText(row.verdict),
      ]);
    }
    distSheet.addRow([]);
    distSheet.addRow([
      'NHÓM',
      'Tổng theo phòng ban',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
    const inView = saleRows.map(([saleId, data]) => ({
      saleId,
      revenue: this.saleRevenueRow(data),
      departments: data.departments,
    }));
    const { groups, company } = await this.rollupGroups(inView, window);
    for (const group of groups) {
      distSheet.addRow([
        'Nhóm',
        group.name,
        this.reachedText(group.keyCustomers),
        this.reachedText(group.nonCustomers),
        group.dsoKey,
        group.dsoNon,
        this.ratioText(group.keyShareRatio),
        group.quarterTarget,
        this.percentText(group.achievedPct),
        this.verdictText(group.verdict),
      ]);
    }
    distSheet.addRow([]);
    distSheet.addRow([
      'CÔNG TY',
      'Tổng công ty',
      this.reachedText(company.keyCustomers),
      this.reachedText(company.nonCustomers),
      company.dsoKey,
      company.dsoNon,
      this.ratioText(company.keyShareRatio),
      company.quarterTarget,
      this.percentText(company.achievedPct),
      this.verdictText(company.verdict),
    ]);

    const detailSheet = wb.addWorksheet('CHI TIET');
    detailSheet.addRow([
      'Sale',
      'Mã KH',
      'Tên khách hàng',
      'Loại',
      'Zalo',
      'Tin vào',
      'Tin ra',
      'Số đơn',
      'Số phiếu NKM',
      'Doanh số NKM',
      'Kết luận loại khách',
      ...criteriaNames,
    ]);
    for (const [, data] of saleRows) {
      for (const customer of data.customers) {
        detailSheet.addRow([
          data.saleName,
          customer.row.customerCode,
          customer.row.customerName,
          customer.row.customerTier ?? '',
          customer.zaloLinked ? 'Có' : 'Không',
          customer.totals.inbound,
          customer.totals.outbound,
          customer.totals.orders,
          this.occurrenceCell(customer.criteria),
          this.occurrenceRevenueCell(customer.criteria),
          this.tierCell(customer.tierSummary),
          ...customer.criteria.map((c) => this.customerCell(c)),
        ]);
      }
    }

    const buffer = await wb.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(buffer),
      fileName: `bao-cao-kpi-khach-hang_${from}_${to}.xlsx`,
    };
  }

  private criterionCell(c: SaleCriterion): string {
    if (c.overridden) return 'Không đạt (ghi đè)';
    if (c.status === 'no_data') return 'Thiếu dữ liệu';
    if (c.scoringMode === 'ratio') {
      const num = c.passedCriteria ?? c.numerator ?? 0;
      const den = c.totalCriteria ?? c.denominatorValue ?? 0;
      return `${c.actualValue}% (${num}/${den})`;
    }
    return c.status === 'pass'
      ? `Đạt (${c.passedCriteria ?? 0}/${c.totalCriteria ?? 0})`
      : `Không đạt (${c.passedCriteria ?? 0}/${c.totalCriteria ?? 0})`;
  }

  private customerCell(c: CustomerCriterion): string {
    if (c.overridden) return 'Không đạt (ghi đè)';
    if (c.status === 'no_data') return '—';
    if (c.status === 'pass') return 'Đạt';
    if (c.status === 'fail') return 'Không đạt';
    return `${c.actualValue}%`;
  }

  /** Số phiếu khách mua trong kỳ — ô của tiêu chí doanh số đúng loại khách. */
  private occurrenceCell(criteria: CustomerCriterion[]): number | string {
    const found = criteria.find(
      (criterion) =>
        (criterion.key === 'doanh_so_key' ||
          criterion.key === 'doanh_so_non') &&
        criterion.quantity !== undefined,
    );
    if (!found) return '';
    return found.quantity ?? 0;
  }

  /** Doanh số của khách trong kỳ (LineTotal, chưa VAT). */
  private occurrenceRevenueCell(
    criteria: CustomerCriterion[],
  ): number | string {
    const found = criteria.find(
      (criterion) => criterion.lineTotal !== undefined,
    );
    if (!found) return '';
    return found.lineTotal ?? 0;
  }

  /**
   * Kết luận theo loại khách: KEY phải đạt cả 4 tiêu chí, NON chỉ đếm "đạt x/4"
   * (không cho ra đạt/trượt).
   */
  private tierCell(summary: CustomerTierSummary | undefined): string {
    if (!summary || summary.applicable === 0) return '';
    if (summary.tier === 'KEY') {
      return summary.verdict === 'pass' ? 'Đạt toàn bộ' : 'Thiếu tiêu chí';
    }
    return `Đạt ${summary.passed}/${summary.applicable} tiêu chí`;
  }

  private reachedText(value: { reached: number; total: number }): string {
    return `${value.reached}/${value.total}`;
  }

  private ratioText(value: number | null): string {
    if (value === null) return '';
    // 4 chữ số thập phân — doanh thu nhiều số lẻ nên giữ đủ như thiết kế §1.2
    return value.toFixed(4).replace('.', ',');
  }

  private percentText(value: number | null): string {
    if (value === null) return '';
    return `${String(value).replace('.', ',')}%`;
  }

  private verdictText(value: 'pass' | 'fail' | null): string {
    if (value === 'pass') return 'Đạt';
    if (value === 'fail') return 'Không đạt';
    return '';
  }

  // ------------------------------------------------------------- helpers

  private today(): string {
    return vnToday();
  }

  private shiftDate(date: string, days: number): string {
    return shiftDateStr(date, days);
  }

  private diffDays(earlier: string, later: string): number {
    return diffDateStr(earlier, later);
  }

  private lastDayWhere(
    days: ActivityDayRow[],
    predicate: (day: ActivityDayRow) => boolean,
  ): string | null {
    let latest: string | null = null;
    for (const day of days) {
      if (predicate(day) && (latest === null || day.stat_date > latest)) {
        latest = day.stat_date;
      }
    }
    return latest;
  }

  async getCustomerDetail(
    assignmentId: number,
    from: string,
    to: string,
    user: any,
  ) {
    // findOne đã kiểm tra tồn tại + phạm vi
    const detail = await this.customersService.findOne(assignmentId, user);
    const daily = await this.customersService.getResponseDaily(
      assignmentId,
      from,
      to,
      user,
    );

    return {
      customer: detail.customer,
      assignment: {
        assignmentId: detail.assignmentId,
        departmentSlug: detail.departmentSlug,
        customerTier: detail.customerTier,
        sale: detail.sale,
      },
      zaloAccounts: detail.zaloAccounts,
      ...daily,
    };
  }
}

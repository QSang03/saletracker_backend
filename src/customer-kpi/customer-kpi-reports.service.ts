import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as ExcelJS from 'exceljs';
import { User } from '../users/user.entity';
import { Customer } from './customer.entity';
import { CustomerAssignment } from './customer-assignment.entity';
import { CustomerActivityDaily } from './customer-activity-daily.entity';
import { KpiDefinition } from './kpi-definition.entity';
import { KpiTarget } from './kpi-target.entity';
import { CustomersService } from './customers.service';
import { diffDateStr, shiftDateStr, vnToday } from './vn-date';
import {
  ActivityDayRow,
  CustomerCriterion,
  CustomerKpiScoringService,
  SaleCriterion,
  SUGGESTION_GAP_DAYS,
} from './customer-kpi-scoring.service';

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

interface AssignmentRow {
  assignmentId: number;
  saleId: number;
  customerId: number;
  customerCode: string;
  customerName: string;
  customerTier: string | null;
}

/**
 * Báo cáo KPI. Engine chấm điểm nằm ở CustomerKpiScoringService (tính lúc đọc
 * từ kpi_definitions + customer_activity_daily — sửa tiêu chí là hiện ngay,
 * không đợi cron). Bảng customer_response_daily chỉ dùng cho màn hình chi tiết
 * khách hàng (mục 4.7 — không dùng chấm KPI).
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

  private async loadSaleInfos(
    saleIds: number[],
  ): Promise<Map<number, { fullName: string; zaloLinked: boolean }>> {
    const result = new Map();
    if (saleIds.length === 0) return result;
    const users = await this.userRepo.find({
      where: { id: In([...new Set(saleIds)]) },
      select: ['id', 'fullName', 'zaloLinkStatus'],
    });
    for (const user of users) {
      result.set(user.id, {
        fullName: user.fullName,
        zaloLinked: Number(user.zaloLinkStatus) === 1,
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

  // ------------------------------------------------------- dữ liệu chấm

  private buildScoredData(
    assignments: AssignmentRow[],
    activity: Map<number, ActivityDayRow[]>,
    targets: Map<string, number>,
    definitions: KpiDefinition[],
    saleInfos: Map<number, { fullName: string; zaloLinked: boolean }>,
    fromDate: string,
    months: string[],
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
        criteria: SaleCriterion[];
        customers: {
          row: AssignmentRow;
          zaloLinked: boolean;
          criteria: CustomerCriterion[];
          totals: {
            inbound: number;
            outbound: number;
            orders: number;
            revenue: number;
          };
        }[];
      }
    >();

    for (const [saleId, saleCustomers] of customersBySale) {
      const saleInfo = saleInfos.get(saleId);
      const saleCriteria: SaleCriterion[] = [];
      const customerRows: {
        row: AssignmentRow;
        zaloLinked: boolean;
        criteria: CustomerCriterion[];
        totals: {
          inbound: number;
          outbound: number;
          orders: number;
          revenue: number;
        };
      }[] = [];

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
            criterion: this.scoring.scoreCustomer(
              definition,
              days,
              customerTarget,
              fromDate,
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
            perCustomer.map((c) => ({ days: c.days })),
            saleTarget,
            saleInfo?.zaloLinked ?? false,
            fromDate,
          ),
        );
      }

      for (const row of saleCustomers) {
        const days = activity.get(row.assignmentId) ?? [];
        const criteria = definitions.map((definition) => {
          const customerTarget = this.scoring.resolveCustomerTarget(
            definition,
            targets.get(`${saleId}|${row.customerId}|${definition.key}`) ??
              null,
            targets.get(`${saleId}|0|${definition.key}`) ?? null,
          );
          return this.scoring.scoreCustomer(
            definition,
            days,
            customerTarget,
            fromDate,
          );
        });
        const latest = days[days.length - 1];
        customerRows.push({
          row,
          zaloLinked: Boolean(latest?.zalo_linked),
          criteria,
          totals: days.reduce(
            (acc, day) => ({
              inbound: acc.inbound + day.inbound_count,
              outbound: acc.outbound + day.outbound_count,
              orders: acc.orders + day.order_count,
              revenue: acc.revenue + day.revenue,
            }),
            { inbound: 0, outbound: 0, orders: 0, revenue: 0 },
          ),
        });
      }

      scored.set(saleId, {
        saleName: saleInfo?.fullName ?? `Sale #${saleId}`,
        zaloLinked: saleInfo?.zaloLinked ?? false,
        criteria: saleCriteria,
        customers: customerRows,
      });
    }

    return scored;
  }

  // ------------------------------------------------------------- API

  /**
   * Pipeline dùng chung cho overview / by-sale / export: nạp phân công +
   * hoạt động (kèm lookback cho bài toán gợi ý) + chỉ tiêu rồi chấm điểm.
   * Map rỗng = người dùng không thấy sale nào trong phạm vi.
   */
  private async buildScoredFor(
    saleId: number | undefined,
    from: string,
    to: string,
    user: any,
  ) {
    const userIds = await this.scopeUserIds(user);
    if (userIds !== undefined && userIds.length === 0) {
      return new Map();
    }
    if (saleId !== undefined) {
      this.assertSaleInScope(saleId, userIds);
    }
    const lookbackFrom = this.shiftDate(from, -SUGGESTION_GAP_DAYS);
    const assignments = await this.loadAssignments(userIds, saleId);
    const definitions = await this.loadDefinitions();
    const activity = await this.loadActivity(
      assignments.map((row) => row.assignmentId),
      lookbackFrom,
      to,
    );
    const targets = await this.loadTargets(
      assignments.map((row) => row.saleId),
      definitions.map((definition) => definition.key),
      this.monthsInRange(from, to),
    );
    const saleInfos = await this.loadSaleInfos([
      ...new Set(assignments.map((row) => row.saleId)),
    ]);
    return this.buildScoredData(
      assignments,
      activity,
      targets,
      definitions,
      saleInfos,
      from,
      this.monthsInRange(from, to),
    );
  }

  async overview(query: any, user: any) {
    const scored = await this.buildScoredFor(
      query.saleId,
      query.from,
      query.to,
      user,
    );

    // search = lọc theo TÊN SALE (dataset là các sale trong phạm vi — khách
    // hàng không nằm trong response của overview)
    const search = String(query.search ?? '')
      .trim()
      .toLowerCase();

    const sales = [...scored.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(
        ([, data]) => !search || data.saleName.toLowerCase().includes(search),
      )
      .map(([saleId, data]) => ({
        saleId,
        saleName: data.saleName,
        zaloLinked: data.zaloLinked,
        criteria: data.criteria,
      }));
    return { from: query.from, to: query.to, sales };
  }

  async bySale(query: any, user: any) {
    // Bảng khách hàng của MỘT sale — không cho quét toàn công ty trong một call
    // (9.8k khách × tiêu chí sẽ là payload hàng chục MB nếu thiếu saleId)
    if (query.saleId === undefined) {
      throw new BadRequestException(
        'by-sale bắt buộc truyền saleId (bảng khách hàng của một sale)',
      );
    }
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 100));
    const scored = await this.buildScoredFor(
      query.saleId,
      query.from,
      query.to,
      user,
    );

    const entry = scored.get(query.saleId);
    if (!entry) {
      return {
        from: query.from,
        to: query.to,
        page,
        pageSize,
        total: 0,
        sales: [],
      };
    }

    // search = lọc khách theo mã hoặc tên (chấm điểm vẫn tính trên TOÀN BỘ
    // khách của sale — lọc chỉ tác động tới danh sách hiển thị)
    const search = String(query.search ?? '')
      .trim()
      .toLowerCase();
    const customers = search
      ? entry.customers.filter(
          (customer) =>
            customer.row.customerCode.toLowerCase().includes(search) ||
            (customer.row.customerName ?? '').toLowerCase().includes(search),
        )
      : entry.customers;
    const total = customers.length;
    const paged = customers
      .slice((page - 1) * pageSize, page * pageSize)
      .map((customer) => ({
        assignmentId: customer.row.assignmentId,
        customerId: customer.row.customerId,
        customerCode: customer.row.customerCode,
        customerName: customer.row.customerName,
        customerTier: customer.row.customerTier,
        zaloLinked: customer.zaloLinked,
        totals: customer.totals,
        criteria: customer.criteria,
      }));

    return {
      from: query.from,
      to: query.to,
      page,
      pageSize,
      total,
      sales: [
        {
          saleId: query.saleId,
          saleName: entry.saleName,
          zaloLinked: entry.zaloLinked,
          criteria: entry.criteria,
          customers: paged,
        },
      ],
    };
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

  async exportReport(
    saleId: number | undefined,
    from: string,
    to: string,
    user: any,
  ) {
    // Dùng pipeline chung một lần duy nhất — export KHÔNG truyền saleId vẫn
    // được (toàn công ty) vì sheet CHI TIET được dựng từ dữ liệu đã chấm,
    // không đi qua by-sale (nơi bắt buộc saleId để giới hạn payload)
    const scored = await this.buildScoredFor(saleId, from, to, user);
    const saleRows = [...scored.entries()].sort((a, b) => a[0] - b[0]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'saletracker';
    const summary = wb.addWorksheet('TONG KET');
    const criteriaNames = saleRows[0]?.[1].criteria.map((c) => c.name) ?? [];

    summary.addRow([`Báo cáo KPI khách hàng ${from} → ${to}`]);
    summary.addRow([]);
    summary.addRow(['Sale', ...criteriaNames]);
    for (const [, data] of saleRows) {
      summary.addRow([
        data.saleName,
        ...data.criteria.map((c) => this.criterionCell(c)),
      ]);
    }

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
      'Doanh thu',
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
          customer.totals.revenue,
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
    if (c.status === 'no_data') return '—';
    if (c.status === 'pass') return 'Đạt';
    if (c.status === 'fail') return 'Không đạt';
    return `${c.actualValue}%`;
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

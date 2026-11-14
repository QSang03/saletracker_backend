import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CustomerAppointment } from './customer-appointment.entity';
import { CustomerAssignment, CustomerTier } from './customer-assignment.entity';
import { CustomerStatus } from './customer.entity';
import { KpiDefinition, ScoringMode } from './kpi-definition.entity';
import {
  KpiVisitTarget,
  KpiVisitTargetPeriod,
  KpiVisitTargetTier,
  KpiVisitTargetType,
} from './kpi-visit-target.entity';
import {
  AssignVisitTargetDto,
  VisitCoverageQueryDto,
  VisitTargetQueryDto,
} from './dto/kpi-visit.dto';
import { KpiScopeService, KpiUser } from './kpi-scope.service';
import { KpiSaleDirectoryService } from './kpi-sale-directory.service';
import { KpiCustomerNamesService } from './kpi-customer-names.service';
import { CustomerAppointmentsService } from './customer-appointments.service';
import {
  FiscalQuarter,
  fiscalQuarterOf,
  fiscalQuarterRange,
  fiscalYearOf,
} from './nkm-fiscal';
import { shiftDateStr, vnToday } from './vn-date';

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUARTER_KEY_REGEX = /^\d{4}-Q[1-4]$/;
const VISIT_CRITERION_KEY = 'support_khach';
/** % mặc định khi chưa cấu hình target và definition cũng chưa có giá trị. */
const DEFAULT_MONTHLY_PERCENT = 20;
/** Số khách mặc định khi definition chấm binary nhưng target_value không hợp lệ. */
const DEFAULT_MONTHLY_COUNT = 1;

interface AssignmentRow {
  assignmentId: number;
  customerId: number;
  customerCode: string;
  customerName: string | null;
  sapCode: string;
  tier: 'KEY' | 'NON';
  departmentSlug: string;
  visitedMonth: boolean;
  visitedQuarter: boolean;
  visitCountMonth: number;
  visitCountQuarter: number;
  lastVisitMonthAt: string | null;
  lastVisitQuarterAt: string | null;
  lastAppointmentCode: string | null;
}

interface VisitAgg {
  monthCount: number;
  quarterCount: number;
  lastMonthAt: string | null;
  lastQuarterAt: string | null;
  lastAppointmentCode: string | null;
}

interface TargetDefinition {
  type: 'count' | 'percent';
  value: number;
  source: 'sale_target' | 'kpi_definition' | 'derived_month';
}

interface CoverageSummary {
  totalCustomers: number;
  visitedMonth: number;
  visitedQuarter: number;
  visitCountMonth: number;
  visitCountQuarter: number;
  coverageMonthPct: number | null;
  coverageQuarterPct: number | null;
}

/**
 * Trang "Tiến độ gặp khách" — trả lời 3 câu:
 *   1. Tháng này đã gặp bao nhiêu khách KEY/NON, còn thiếu bao nhiêu?
 *   2. Quý tài chính này đã gặp bao nhiêu, còn thiếu bao nhiêu?
 *   3. Khách nào đã gặp / chưa gặp để sale lên kế hoạch.
 *
 * Luật chấm:
 *   - Chỉ lịch `completed`, `mapping_status='matched'`, có `checkin_at`.
 *   - Ngày tính theo `checkin_at` (giờ VN), không theo `scheduled_at`.
 *   - KPI đếm KHÁCH DISTINCT; gặp nhiều lần chỉ tăng `visitCount`.
 *   - Quý theo năm tài chính: Q1=4–6, Q2=7–9, Q3=10–12, Q4=1–3.
 *
 * Chỉ tiêu:
 *   - `count`: số khách, bắt buộc cấu hình riêng từng sale.
 *   - `percent`: % trên tổng khách được giao, gán được hàng loạt theo phòng.
 *   - Không có dòng target → lấy `kpi_definitions.support_khach.target_value`
 *     làm target % toàn cục; quý suy ra từ tháng (percent giữ nguyên,
 *     count ×3 nếu tháng đã cấu hình count riêng).
 */
@Injectable()
export class KpiVisitCoverageService {
  constructor(
    @InjectRepository(CustomerAssignment)
    private readonly assignmentRepo: Repository<CustomerAssignment>,
    @InjectRepository(CustomerAppointment)
    private readonly appointmentRepo: Repository<CustomerAppointment>,
    @InjectRepository(KpiDefinition)
    private readonly definitionRepo: Repository<KpiDefinition>,
    @InjectRepository(KpiVisitTarget)
    private readonly targetRepo: Repository<KpiVisitTarget>,
    private readonly scope: KpiScopeService,
    private readonly saleDirectory: KpiSaleDirectoryService,
    private readonly customerNames: KpiCustomerNamesService,
    private readonly appointments: CustomerAppointmentsService,
  ) {}

  private isPrivileged(user: KpiUser): boolean {
    const roles = this.scope.roleNames(user);
    return (
      roles.includes('admin') ||
      roles.includes('view') ||
      roles.includes('pm-khach-hang') ||
      roles.some((role) => role.startsWith('manager-'))
    );
  }

  private resolveSaleId(
    query: { saleId?: number },
    user: KpiUser,
    userIds: number[] | undefined,
  ): number {
    if (query.saleId !== undefined) {
      this.scope.assertSaleInScope(query.saleId, userIds);
      return query.saleId;
    }
    if (this.isPrivileged(user)) {
      throw new BadRequestException(
        'Cần truyền saleId khi xem tiến độ gặp khách của sale khác',
      );
    }
    if (!user?.id) {
      throw new ForbiddenException('Không xác định được người dùng');
    }
    return Number(user.id);
  }

  private resolvePeriods(query: VisitCoverageQueryDto): {
    monthKey: string;
    monthFrom: string;
    monthTo: string;
    quarter: FiscalQuarter;
    quarterKey: string;
  } {
    let quarter: FiscalQuarter | null = null;
    if (query.fiscal_year !== undefined || query.quarter !== undefined) {
      if (query.fiscal_year === undefined || query.quarter === undefined) {
        throw new BadRequestException(
          'fiscal_year và quarter phải đi cùng nhau',
        );
      }
      quarter = fiscalQuarterRange(query.fiscal_year, query.quarter);
      if (!quarter) {
        throw new BadRequestException('fiscal_year/quarter không hợp lệ');
      }
    }

    let monthKey = query.period;
    if (!monthKey) {
      const currentMonth = vnToday().slice(0, 7);
      if (quarter) {
        const currentStart = `${currentMonth}-01`;
        monthKey =
          currentStart >= quarter.from && currentStart <= quarter.to
            ? currentMonth
            : quarter.from.slice(0, 7);
      } else {
        monthKey = currentMonth;
      }
    }
    if (!MONTH_REGEX.test(monthKey)) {
      throw new BadRequestException('period phải có dạng YYYY-MM');
    }
    const monthFrom = `${monthKey}-01`;
    const [year, month] = monthKey.split('-').map(Number);
    const nextMonth =
      month === 12
        ? `${year + 1}-01-01`
        : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const monthTo = shiftDateStr(nextMonth, -1);

    if (!quarter) {
      quarter = fiscalQuarterRange(
        fiscalYearOf(monthFrom),
        fiscalQuarterOf(monthFrom),
      );
    }
    if (!quarter) {
      throw new BadRequestException('fiscal_year/quarter không hợp lệ');
    }
    if (monthFrom < quarter.from || monthTo > quarter.to) {
      throw new BadRequestException(
        `Tháng ${monthKey} không nằm trong ${quarter.label}`,
      );
    }
    return {
      monthKey,
      monthFrom,
      monthTo,
      quarter,
      quarterKey: `${quarter.fiscalYear}-Q${quarter.quarter}`,
    };
  }

  private async loadAssignments(saleId: number): Promise<AssignmentRow[]> {
    const assignments = await this.assignmentRepo.find({
      where: { sale_id: saleId },
      relations: ['customer'],
    });
    return assignments
      .filter(
        (assignment) =>
          assignment.customer &&
          assignment.customer.status !== CustomerStatus.DELETED,
      )
      .map((assignment) => ({
        assignmentId: assignment.id,
        customerId: assignment.customer_id,
        customerCode: assignment.customer.customer_code,
        customerName: assignment.customer.customer_name ?? null,
        sapCode: assignment.customer.sap_code ?? '',
        tier: assignment.customer_tier === CustomerTier.KEY ? 'KEY' : 'NON',
        departmentSlug: assignment.department_slug,
        visitedMonth: false,
        visitedQuarter: false,
        visitCountMonth: 0,
        visitCountQuarter: 0,
        lastVisitMonthAt: null,
        lastVisitQuarterAt: null,
        lastAppointmentCode: null,
      }));
  }

  private async loadVisits(
    saleId: number,
    quarter: FiscalQuarter,
  ): Promise<CustomerAppointment[]> {
    return this.appointmentRepo
      .createQueryBuilder('ap')
      .where('ap.user_id = :saleId', { saleId })
      .andWhere('ap.status = :completed', { completed: 'completed' })
      .andWhere('ap.mapping_status = :matched', { matched: 'matched' })
      .andWhere('ap.checkin_at IS NOT NULL')
      .andWhere('ap.checkin_at >= :from', {
        from: `${quarter.from} 00:00:00`,
      })
      .andWhere('ap.checkin_at < :until', {
        until: `${shiftDateStr(quarter.to, 1)} 00:00:00`,
      })
      .orderBy('ap.checkin_at', 'ASC')
      .getMany();
  }

  private buildVisitMap(
    visits: CustomerAppointment[],
    monthFrom: string,
    monthTo: string,
  ): Map<number, VisitAgg> {
    const result = new Map<number, VisitAgg>();
    for (const visit of visits) {
      if (!visit.customer_id) continue;
      const current = result.get(visit.customer_id) ?? {
        monthCount: 0,
        quarterCount: 0,
        lastMonthAt: null,
        lastQuarterAt: null,
        lastAppointmentCode: null,
      };
      current.quarterCount += 1;
      current.lastQuarterAt = visit.checkin_at;
      current.lastAppointmentCode = visit.appointment_code;
      const day = (visit.checkin_at ?? '').slice(0, 10);
      if (day >= monthFrom && day <= monthTo) {
        current.monthCount += 1;
        current.lastMonthAt = visit.checkin_at;
      }
      result.set(visit.customer_id, current);
    }
    return result;
  }

  private applyVisits(
    assignments: AssignmentRow[],
    visitMap: Map<number, VisitAgg>,
    names: Map<string, string>,
  ): AssignmentRow[] {
    return assignments.map((assignment) => {
      const visit = visitMap.get(assignment.customerId);
      return {
        ...assignment,
        customerName:
          names.get(assignment.customerCode) ?? assignment.customerName,
        visitedMonth: (visit?.monthCount ?? 0) > 0,
        visitedQuarter: (visit?.quarterCount ?? 0) > 0,
        visitCountMonth: visit?.monthCount ?? 0,
        visitCountQuarter: visit?.quarterCount ?? 0,
        lastVisitMonthAt: visit?.lastMonthAt ?? null,
        lastVisitQuarterAt: visit?.lastQuarterAt ?? null,
        lastAppointmentCode: visit?.lastAppointmentCode ?? null,
      };
    });
  }

  private summarize(
    rows: AssignmentRow[],
    visitCountMonth: number,
    visitCountQuarter: number,
  ): CoverageSummary {
    const visitedMonth = rows.filter((row) => row.visitedMonth).length;
    const visitedQuarter = rows.filter((row) => row.visitedQuarter).length;
    return {
      totalCustomers: rows.length,
      visitedMonth,
      visitedQuarter,
      visitCountMonth,
      visitCountQuarter,
      coverageMonthPct:
        rows.length > 0
          ? Math.round((visitedMonth / rows.length) * 1000) / 10
          : null,
      coverageQuarterPct:
        rows.length > 0
          ? Math.round((visitedQuarter / rows.length) * 1000) / 10
          : null,
    };
  }

  private progress(
    target: TargetDefinition | null,
    visited: number,
    total: number,
    visitCount: number,
  ): any {
    if (!target) return null;
    const value = Number(target.value);
    const targetCustomers =
      target.type === 'count'
        ? Math.round(value)
        : Math.ceil((total * value) / 100);
    const exempt = target.type === 'percent' && total === 0;
    return {
      type: target.type,
      value,
      source: target.source,
      targetCustomers,
      visited,
      visitCount,
      rate:
        target.type === 'count'
          ? targetCustomers > 0
            ? Math.round((visited / targetCustomers) * 1000) / 10
            : null
          : total > 0
            ? Math.round((visited / total) * 1000) / 10
            : null,
      remaining: Math.max(0, targetCustomers - visited),
      passed: exempt ? true : visited >= targetCustomers,
      status: exempt ? 'exempt' : visited >= targetCustomers ? 'pass' : 'fail',
      exempt,
    };
  }

  private async loadTargetDefinitions(
    saleId: number,
    monthKey: string,
    quarterKey: string,
  ): Promise<{
    month: TargetDefinition;
    quarter: TargetDefinition;
    tier: Map<string, KpiVisitTarget>;
  }> {
    const [rows, definition] = await Promise.all([
      this.targetRepo.find({
        where: {
          sale_id: saleId,
          period_key: In([monthKey, quarterKey]),
        },
      }),
      this.definitionRepo.findOne({
        where: { key: VISIT_CRITERION_KEY, team_group: 'kinh-doanh' },
      }),
    ]);

    const byKey = new Map<string, KpiVisitTarget>();
    for (const row of rows) {
      byKey.set(`${row.period_type}|${row.customer_tier}`, row);
    }

    const configuredMonth = byKey.get(
      `${KpiVisitTargetPeriod.MONTH}|${KpiVisitTargetTier.ALL}`,
    );
    const fallbackValue = Number(definition?.target_value);
    // Cùng một tiêu chí `support_khach`: đọc đúng mode đang cấu hình.
    // - binary → target_value là SỐ KHÁCH (vd 60 khách)
    // - ratio  → target_value là % (vd 60%)
    // Trước đây luôn ép %, nên cấu hình 60 khách vẫn hiện "60%".
    const fallbackType: 'count' | 'percent' =
      definition?.scoring_mode === ScoringMode.BINARY ? 'count' : 'percent';
    const fallbackTarget =
      fallbackType === 'count'
        ? Number.isFinite(fallbackValue) && fallbackValue >= 1
          ? Math.round(fallbackValue)
          : DEFAULT_MONTHLY_COUNT
        : Number.isFinite(fallbackValue) &&
            fallbackValue > 0 &&
            fallbackValue <= 100
          ? fallbackValue
          : DEFAULT_MONTHLY_PERCENT;
    const month: TargetDefinition = configuredMonth
      ? {
          type:
            configuredMonth.target_type === KpiVisitTargetType.PERCENT
              ? 'percent'
              : 'count',
          value: Number(configuredMonth.target_value),
          source: 'sale_target',
        }
      : {
          type: fallbackType,
          value: fallbackTarget,
          source: 'kpi_definition',
        };

    const configuredQuarter = byKey.get(
      `${KpiVisitTargetPeriod.QUARTER}|${KpiVisitTargetTier.ALL}`,
    );
    const quarter: TargetDefinition = configuredQuarter
      ? {
          type:
            configuredQuarter.target_type === KpiVisitTargetType.PERCENT
              ? 'percent'
              : 'count',
          value: Number(configuredQuarter.target_value),
          source: 'sale_target',
        }
      : {
          type: month.type,
          value: month.type === 'count' ? month.value * 3 : month.value,
          source: 'derived_month',
        };

    return { month, quarter, tier: byKey };
  }

  private tierTarget(
    targets: Map<string, KpiVisitTarget>,
    period: KpiVisitTargetPeriod,
    tier: 'KEY' | 'NON',
  ): TargetDefinition | null {
    const row = targets.get(`${period}|${tier}`);
    if (!row) return null;
    return {
      type:
        row.target_type === KpiVisitTargetType.PERCENT ? 'percent' : 'count',
      value: Number(row.target_value),
      source: 'sale_target',
    };
  }

  async getCoverage(query: VisitCoverageQueryDto, user: KpiUser): Promise<any> {
    const userIds = await this.scope.scopeUserIds(user);
    const saleId = this.resolveSaleId(query, user, userIds);
    const periods = this.resolvePeriods(query);
    const { monthKey, monthFrom, monthTo, quarter, quarterKey } = periods;

    const assignmentPromise = this.loadAssignments(saleId).then(
      async (rows) => ({
        rows,
        names: await this.customerNames.load([
          ...new Set(rows.map((row) => row.customerCode)),
        ]),
      }),
    );
    const [{ rows: assignments, names }, visits, sync, saleInfos, targets] =
      await Promise.all([
        assignmentPromise,
        this.loadVisits(saleId, quarter),
        this.appointments.syncStatus(),
        this.saleDirectory.loadSaleInfos([saleId]),
        this.loadTargetDefinitions(saleId, monthKey, quarterKey),
      ]);

    const visitMap = this.buildVisitMap(visits, monthFrom, monthTo);
    const enriched = this.applyVisits(assignments, visitMap, names);
    const assignedCustomerIds = new Set(
      assignments.map((assignment) => assignment.customerId),
    );
    const relevantVisits = visits.filter(
      (visit) =>
        visit.customer_id && assignedCustomerIds.has(visit.customer_id),
    );
    // Cùng một khách có thể có 2 assignment (2 phòng) — ưu tiên KEY khi cộng
    // lượt gặp theo nhóm để không đếm trùng một lịch.
    const tierByCustomer = new Map<number, 'KEY' | 'NON'>();
    for (const assignment of assignments) {
      if (
        assignment.tier === 'KEY' ||
        !tierByCustomer.has(assignment.customerId)
      ) {
        tierByCustomer.set(assignment.customerId, assignment.tier);
      }
    }
    const tierVisits = {
      KEY: { month: 0, quarter: 0 },
      NON: { month: 0, quarter: 0 },
    };
    let monthVisitCount = 0;
    for (const visit of relevantVisits) {
      const tier = visit.customer_id
        ? tierByCustomer.get(visit.customer_id)
        : undefined;
      if (!tier) continue;
      tierVisits[tier].quarter += 1;
      const day = (visit.checkin_at ?? '').slice(0, 10);
      if (day >= monthFrom && day <= monthTo) {
        tierVisits[tier].month += 1;
        monthVisitCount += 1;
      }
    }

    const total = this.summarize(
      enriched,
      monthVisitCount,
      relevantVisits.length,
    );
    const keyRows = enriched.filter((row) => row.tier === 'KEY');
    const nonRows = enriched.filter((row) => row.tier === 'NON');
    const keyTotal = this.summarize(
      keyRows,
      tierVisits.KEY.month,
      tierVisits.KEY.quarter,
    );
    const nonTotal = this.summarize(
      nonRows,
      tierVisits.NON.month,
      tierVisits.NON.quarter,
    );

    const keyTargetMonth = this.tierTarget(
      targets.tier,
      KpiVisitTargetPeriod.MONTH,
      'KEY',
    );
    const keyTargetQuarter = this.tierTarget(
      targets.tier,
      KpiVisitTargetPeriod.QUARTER,
      'KEY',
    );
    const nonTargetMonth = this.tierTarget(
      targets.tier,
      KpiVisitTargetPeriod.MONTH,
      'NON',
    );
    const nonTargetQuarter = this.tierTarget(
      targets.tier,
      KpiVisitTargetPeriod.QUARTER,
      'NON',
    );

    const unresolvedVisitCount = await this.appointmentRepo
      .createQueryBuilder('ap')
      .where('ap.user_id = :saleId', { saleId })
      .andWhere('ap.status = :completed', { completed: 'completed' })
      .andWhere('ap.checkin_at IS NOT NULL')
      .andWhere('ap.checkin_at >= :from', {
        from: `${quarter.from} 00:00:00`,
      })
      .andWhere('ap.checkin_at < :until', {
        until: `${shiftDateStr(quarter.to, 1)} 00:00:00`,
      })
      .andWhere('(ap.mapping_status <> :matched OR ap.customer_id IS NULL)', {
        matched: 'matched',
      })
      .getCount();

    const visitPeriod = query.visitPeriod ?? 'month';
    const visited = query.visited ?? 'all';
    const search = (query.search ?? '').trim().toLowerCase();
    const filtered = enriched
      .filter(
        (row) => !query.tier || query.tier === 'ALL' || row.tier === query.tier,
      )
      .filter((row) => {
        if (visited === 'all') return true;
        const isVisited =
          visitPeriod === 'month' ? row.visitedMonth : row.visitedQuarter;
        return visited === 'visited' ? isVisited : !isVisited;
      })
      .filter(
        (row) =>
          !search ||
          row.customerCode.toLowerCase().includes(search) ||
          row.sapCode.toLowerCase().includes(search) ||
          (row.customerName ?? '').toLowerCase().includes(search),
      )
      .sort((a, b) => {
        if (a.tier !== b.tier) return a.tier === 'KEY' ? -1 : 1;
        const aVisited =
          visitPeriod === 'month' ? a.visitedMonth : a.visitedQuarter;
        const bVisited =
          visitPeriod === 'month' ? b.visitedMonth : b.visitedQuarter;
        if (aVisited !== bVisited) return aVisited ? -1 : 1;
        return a.customerCode.localeCompare(b.customerCode);
      });

    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

    return {
      saleId,
      saleName: saleInfos.get(saleId)?.fullName ?? null,
      month: {
        key: monthKey,
        label: `Tháng ${Number(monthKey.slice(5, 7))}/${monthKey.slice(0, 4)}`,
        from: monthFrom,
        to: monthTo,
      },
      quarter: {
        key: quarterKey,
        fiscalYear: quarter.fiscalYear,
        quarter: quarter.quarter,
        label: quarter.label,
        from: quarter.from,
        to: quarter.to,
      },
      summary: total,
      targets: {
        month: this.progress(
          targets.month,
          total.visitedMonth,
          total.totalCustomers,
          total.visitCountMonth,
        ),
        quarter: this.progress(
          targets.quarter,
          total.visitedQuarter,
          total.totalCustomers,
          total.visitCountQuarter,
        ),
      },
      byTier: {
        KEY: {
          ...keyTotal,
          targets: {
            month: this.progress(
              keyTargetMonth,
              keyTotal.visitedMonth,
              keyTotal.totalCustomers,
              keyTotal.visitCountMonth,
            ),
            quarter: this.progress(
              keyTargetQuarter,
              keyTotal.visitedQuarter,
              keyTotal.totalCustomers,
              keyTotal.visitCountQuarter,
            ),
          },
        },
        NON: {
          ...nonTotal,
          targets: {
            month: this.progress(
              nonTargetMonth,
              nonTotal.visitedMonth,
              nonTotal.totalCustomers,
              nonTotal.visitCountMonth,
            ),
            quarter: this.progress(
              nonTargetQuarter,
              nonTotal.visitedQuarter,
              nonTotal.totalCustomers,
              nonTotal.visitCountQuarter,
            ),
          },
        },
      },
      customers: pageRows,
      total: filtered.length,
      page,
      pageSize,
      dataQuality: {
        appointmentSync: sync,
        unresolvedVisitCount,
        note:
          [
            sync.stale
              ? 'Dữ liệu lịch hẹn chưa đồng bộ hoặc đã quá 15 phút; số liệu có thể chưa đầy đủ.'
              : null,
            unresolvedVisitCount > 0
              ? 'Có lịch đã gặp nhưng chưa đối chiếu được khách; số liệu có thể thấp hơn thực tế.'
              : null,
          ]
            .filter(Boolean)
            .join(' ') || null,
      },
    };
  }

  private validateTargetInput(dto: AssignVisitTargetDto): void {
    if (dto.period_type === 'month' && !MONTH_REGEX.test(dto.period_key)) {
      throw new BadRequestException(
        'period_key của kỳ tháng phải có dạng YYYY-MM',
      );
    }
    if (
      dto.period_type === 'quarter' &&
      !QUARTER_KEY_REGEX.test(dto.period_key)
    ) {
      throw new BadRequestException(
        'period_key của kỳ quý phải có dạng YYYY-QN (Q1–Q4)',
      );
    }
    if (dto.target_type === 'count') {
      if (dto.scope !== 'sale') {
        throw new BadRequestException(
          'Chỉ tiêu số khách phải cấu hình riêng từng sale',
        );
      }
      if (!Number.isInteger(Number(dto.target_value)) || dto.target_value < 1) {
        throw new BadRequestException(
          'Chỉ tiêu số khách phải là số nguyên dương',
        );
      }
    }
    if (
      dto.target_type === 'percent' &&
      (dto.target_value <= 0 || dto.target_value > 100)
    ) {
      throw new BadRequestException('Chỉ tiêu % phải trong khoảng 0–100');
    }
  }

  private async resolveSaleIds(
    dto: AssignVisitTargetDto,
    user: KpiUser,
  ): Promise<number[]> {
    let saleIds: number[];
    if (dto.scope === 'department') {
      if (!dto.department_slug?.trim()) {
        throw new BadRequestException('Thiếu department_slug');
      }
      const managed = this.scope.managedDepartmentSlugs(user);
      if (
        this.scope.isManager(user) &&
        !managed.includes(dto.department_slug.trim())
      ) {
        throw new ForbiddenException(
          'Bạn chỉ được gán chỉ tiêu cho phòng ban mình quản lý',
        );
      }
      const users = await this.assignmentRepo.manager.query(
        `SELECT DISTINCT u.id
           FROM users u
           INNER JOIN users_departments ud ON ud.user_id = u.id
           INNER JOIN departments d ON d.id = ud.department_id
          WHERE d.slug = ? AND u.deleted_at IS NULL`,
        [dto.department_slug.trim()],
      );
      saleIds = (users as Array<{ id: number | string }>).map((row) =>
        Number(row.id),
      );
      if (saleIds.length === 0) {
        throw new NotFoundException(
          `Không có nhân viên nào trong phòng "${dto.department_slug}"`,
        );
      }
    } else {
      if (!dto.sale_ids?.length) {
        throw new BadRequestException('Thiếu sale_ids[]');
      }
      saleIds = [...new Set(dto.sale_ids.map(Number))].filter(
        (id) => Number.isInteger(id) && id > 0,
      );
      if (saleIds.length === 0) {
        throw new BadRequestException('sale_ids[] không hợp lệ');
      }
    }

    const scoped = await this.scope.scopeUserIds(user);
    if (scoped !== undefined && saleIds.some((id) => !scoped.includes(id))) {
      throw new ForbiddenException(
        'Có sale không thuộc phạm vi bạn được gán chỉ tiêu',
      );
    }
    return saleIds;
  }

  async assignTarget(dto: AssignVisitTargetDto, user: KpiUser): Promise<any> {
    if (!this.scope.canWriteKpi(user)) {
      throw new ForbiddenException(
        'Chỉ admin / pm-khach-hang / quản lý phòng được gán chỉ tiêu',
      );
    }
    this.validateTargetInput(dto);
    const saleIds = await this.resolveSaleIds(dto, user);
    const tier = dto.customer_tier ?? KpiVisitTargetTier.ALL;

    const existing = await this.targetRepo.find({
      where: {
        sale_id: In(saleIds),
        period_type: dto.period_type as KpiVisitTargetPeriod,
        period_key: dto.period_key,
        customer_tier: tier as KpiVisitTargetTier,
      },
    });
    const existingBySale = new Map(existing.map((row) => [row.sale_id, row]));
    let created = 0;
    let updated = 0;
    const rows = saleIds.map((saleId) => {
      const current = existingBySale.get(saleId);
      if (current) {
        current.target_type = dto.target_type as KpiVisitTargetType;
        current.target_value = Number(dto.target_value);
        current.created_by = user.id ?? null;
        updated += 1;
        return current;
      }
      created += 1;
      return this.targetRepo.create({
        sale_id: saleId,
        period_type: dto.period_type as KpiVisitTargetPeriod,
        period_key: dto.period_key,
        target_type: dto.target_type as KpiVisitTargetType,
        target_value: Number(dto.target_value),
        customer_tier: tier as KpiVisitTargetTier,
        created_by: user.id ?? null,
      });
    });
    await this.targetRepo.save(rows);
    return {
      created,
      updated,
      saleIds,
      period_type: dto.period_type,
      period_key: dto.period_key,
      target_type: dto.target_type,
      target_value: Number(dto.target_value),
      customer_tier: tier,
    };
  }

  async listTargets(query: VisitTargetQueryDto, user: KpiUser): Promise<any> {
    const scoped = await this.scope.scopeUserIds(user);
    if (query.saleId !== undefined) {
      this.scope.assertSaleInScope(query.saleId, scoped);
    }
    const qb = this.targetRepo.createQueryBuilder('t');
    if (query.saleId !== undefined) {
      qb.where('t.sale_id = :saleId', { saleId: query.saleId });
    } else if (scoped !== undefined) {
      if (scoped.length === 0) {
        return { data: [], total: 0 };
      }
      qb.where('t.sale_id IN (:...scoped)', { scoped });
    }
    if (query.period_type) {
      qb.andWhere('t.period_type = :periodType', {
        periodType: query.period_type,
      });
    }
    if (query.period_key) {
      qb.andWhere('t.period_key = :periodKey', {
        periodKey: query.period_key,
      });
    }
    const rows = await qb
      .orderBy('t.period_key', 'DESC')
      .addOrderBy('t.sale_id', 'ASC')
      .addOrderBy('t.customer_tier', 'ASC')
      .getMany();
    const saleInfos = await this.saleDirectory.loadSaleInfos([
      ...new Set(rows.map((row) => row.sale_id)),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        saleId: row.sale_id,
        saleName: saleInfos.get(row.sale_id)?.fullName ?? null,
        periodType: row.period_type,
        periodKey: row.period_key,
        targetType: row.target_type,
        targetValue: Number(row.target_value),
        customerTier: row.customer_tier,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      total: rows.length,
    };
  }

  async deleteTarget(id: number, user: KpiUser): Promise<any> {
    if (!this.scope.canWriteKpi(user)) {
      throw new ForbiddenException(
        'Chỉ admin / pm-khach-hang / quản lý phòng được xóa chỉ tiêu',
      );
    }
    const row = await this.targetRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy chỉ tiêu gặp khách');
    const scoped = await this.scope.scopeUserIds(user);
    this.scope.assertSaleInScope(row.sale_id, scoped);
    await this.targetRepo.remove(row);
    return { id, deleted: true };
  }
}

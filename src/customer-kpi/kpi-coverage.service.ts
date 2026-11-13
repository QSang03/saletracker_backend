import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { SystemConfig } from '../system_config/system_config.entity';
import { CustomerAssignment } from './customer-assignment.entity';
import { CustomerRevenueDaily } from './customer-revenue-daily.entity';
import { SaleRevenueTarget } from './sale-revenue-target.entity';
import {
  KpiMonthlyResult,
  KpiMonthlyStatus,
} from './kpi-monthly-result.entity';
import {
  KpiQuarterlySettlement,
  KpiQuarterStatus,
} from './kpi-quarterly-settlement.entity';
import {
  CoverageAssignment,
  CoverageRevenueRow,
  MonthlyCoverageResult,
  SaleSlpMapping,
  computeMonthlyCoverage,
  computeQuarterSettlement,
} from './kpi-coverage.calc';
import {
  FiscalQuarter,
  currentFiscalQuarter,
  fiscalQuarterMonths,
  fiscalQuarterRange,
  previousFiscalQuarter,
} from './nkm-fiscal';
import { KpiScopeService, KpiUser } from './kpi-scope.service';
import {
  KpiSaleDirectoryService,
  KpiSaleInfo,
} from './kpi-sale-directory.service';
import { WorkingDaysService } from './working-days.service';
import {
  RevenueViewMode,
  maskDailyTracking,
  maskMonthlySalary,
  maskQuarterRow,
} from './kpi-mask.helper';
import { KpiRevenueViewService } from './kpi-revenue-view.service';
import { shiftDateStr, vnToday } from './vn-date';

const DEFAULT_COVERAGE_RATE = 60;
const COVERAGE_RATE_CONFIG = 'kpi_monthly_coverage_rate';
/** S1 có thể điều chỉnh dữ liệu 10 ngày đầu quý sau — cron recompute trong 10 ngày. */
const QUARTER_RECOMPUTE_DAYS = 10;

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export interface ComputeMonthlyOptions {
  periodMonth: string;
  saleId?: number;
  user: KpiUser;
  force?: boolean;
  reason?: string;
  /** Cron chạy nội bộ — bỏ qua kiểm tra role. */
  system?: boolean;
}

export interface ComputeQuarterOptions {
  fiscalYear: number;
  quarter: number;
  saleId?: number;
  user: KpiUser;
  force?: boolean;
  reason?: string;
  /** Cron dùng true để bỏ qua settlement đã final thay vì báo lỗi. */
  skipFinalized?: boolean;
  /** Cron chạy nội bộ — bỏ qua kiểm tra role. */
  system?: boolean;
}

export interface DailyTrackingQuery {
  saleId?: number;
  fiscal_year?: number;
  quarter?: number;
  from?: string;
  to?: string;
  user: KpiUser;
}

@Injectable()
export class KpiCoverageService {
  private readonly logger = new Logger(KpiCoverageService.name);

  constructor(
    @InjectRepository(CustomerAssignment)
    private readonly assignmentRepo: Repository<CustomerAssignment>,
    @InjectRepository(CustomerRevenueDaily)
    private readonly revenueRepo: Repository<CustomerRevenueDaily>,
    @InjectRepository(SaleRevenueTarget)
    private readonly quarterTargetRepo: Repository<SaleRevenueTarget>,
    @InjectRepository(KpiMonthlyResult)
    private readonly monthlyRepo: Repository<KpiMonthlyResult>,
    @InjectRepository(KpiQuarterlySettlement)
    private readonly quarterRepo: Repository<KpiQuarterlySettlement>,
    @InjectRepository(SystemConfig)
    private readonly configRepo: Repository<SystemConfig>,
    private readonly scope: KpiScopeService,
    private readonly saleDirectory: KpiSaleDirectoryService,
    private readonly workingDays: WorkingDaysService,
    private readonly revenueView: KpiRevenueViewService,
  ) {}

  // --------------------------------------------------------------- helpers

  private requireWriter(user: KpiUser): void {
    if (!this.scope.canWriteKpi(user)) {
      throw new ForbiddenException(
        'Chỉ admin / pm-khach-hang / quản lý phòng được tính lại KPI',
      );
    }
  }

  private requireFinalApprover(user: KpiUser): void {
    if (!this.scope.isAdminOrPm(user)) {
      throw new ForbiddenException(
        'Chỉ admin / pm-khach-hang được chốt hoặc mở lại quý',
      );
    }
  }

  /**
   * Nhập thưởng tháng là write-only: không role nào được đọc lại số thưởng
   * của sale khác (kể cả admin/pm). Chỉ admin được ghi.
   */
  private requireSalaryWriter(user: KpiUser): void {
    if (!this.scope.roleNames(user).includes('admin')) {
      throw new ForbiddenException(
        'Chỉ admin được nhập thưởng tháng (write-only)',
      );
    }
  }

  /** Tháng trước theo giờ VN — mặc định khi không truyền period. */
  previousMonth(): string {
    const today = vnToday();
    const [y, m] = today.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 2, 1));
    return date.toISOString().slice(0, 7);
  }

  private monthRange(periodMonth: string): { from: string; to: string } {
    if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
      throw new BadRequestException('period phải có dạng YYYY-MM');
    }
    const [year, month] = periodMonth.split('-').map(Number);
    if (month < 1 || month > 12) {
      throw new BadRequestException('period không hợp lệ');
    }
    return {
      from: `${periodMonth}-01`,
      to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    };
  }

  private async getCoverageTargetRate(): Promise<number> {
    const cfg = await this.configRepo.findOne({
      where: { name: COVERAGE_RATE_CONFIG },
    });
    const parsed = Number(cfg?.value);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 100
      ? parsed
      : DEFAULT_COVERAGE_RATE;
  }

  private async resolveSaleIds(
    saleId: number | undefined,
    user: KpiUser,
    system = false,
  ): Promise<{ saleIds: number[]; userIds: number[] | undefined }> {
    const userIds = system ? undefined : await this.scope.scopeUserIds(user);
    if (saleId !== undefined) {
      if (!system) this.scope.assertSaleInScope(saleId, userIds);
      return { saleIds: [saleId], userIds };
    }

    const qb = this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.customer', 'c')
      .innerJoin('a.sale', 'sale')
      .select('DISTINCT a.sale_id', 'saleId')
      .where('c.status <> :deleted', { deleted: 'deleted' })
      .andWhere('sale.deletedAt IS NULL');
    if (userIds !== undefined) {
      if (userIds.length === 0) return { saleIds: [], userIds };
      qb.andWhere('a.sale_id IN (:...userIds)', { userIds });
    }
    const rows = await qb.getRawMany<{ saleId: number | string }>();
    const saleIds = [
      ...new Set(rows.map((row) => Number(row.saleId)).filter(Boolean)),
    ].sort((a, b) => a - b);
    return { saleIds, userIds };
  }

  private async loadAssignments(
    saleIds: number[],
  ): Promise<CoverageAssignment[]> {
    if (saleIds.length === 0) return [];
    const rows = await this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.customer', 'c')
      .select('a.sale_id', 'saleId')
      .addSelect('c.customer_code', 'customerCode')
      .addSelect('a.customer_tier', 'tier')
      .where('a.sale_id IN (:...saleIds)', { saleIds })
      .andWhere('c.status <> :deleted', { deleted: 'deleted' })
      .getRawMany<{
        saleId: number | string;
        customerCode: string;
        tier: string | null;
      }>();
    return rows.map((row) => ({
      saleId: Number(row.saleId),
      customerCode: String(row.customerCode ?? ''),
      tier: row.tier ?? null,
    }));
  }

  private async loadRevenue(
    slpCodes: number[],
    from: string,
    to: string,
  ): Promise<CoverageRevenueRow[]> {
    const codes = [...new Set(slpCodes)].filter(Boolean);
    if (codes.length === 0) return [];
    const result: CoverageRevenueRow[] = [];
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
          slpCode: number | string;
          customerCode: string;
          quantity: string;
          lineTotal: string;
        }>();
      for (const row of rows) {
        result.push({
          slpCode: Number(row.slpCode),
          customerCode: String(row.customerCode ?? ''),
          quantity: Number(row.quantity) || 0,
          lineTotal: Number(row.lineTotal) || 0,
        });
      }
    }
    return result;
  }

  private async loadQuarterTargets(
    mappings: SaleSlpMapping[],
    quarter: FiscalQuarter,
  ): Promise<
    Array<{
      saleId: number;
      targetValue: number;
      actualValue: number;
      hasTarget: boolean;
    }>
  > {
    const slpCodes = [
      ...new Set(mappings.flatMap((mapping) => mapping.slpCodes)),
    ];
    const bySlp = new Map<number, SaleRevenueTarget>();
    if (slpCodes.length > 0) {
      const rows = await this.quarterTargetRepo.find({
        where: {
          slp_code: In(slpCodes),
          fiscal_year: quarter.fiscalYear,
          quarter: quarter.quarter,
        },
      });
      for (const row of rows) bySlp.set(row.slp_code, row);
    }
    return mappings.map((mapping) => {
      let targetValue = 0;
      let actualValue = 0;
      let missing = mapping.slpCodes.length === 0;
      for (const slpCode of mapping.slpCodes) {
        const row = bySlp.get(slpCode);
        if (!row) {
          missing = true;
          continue;
        }
        targetValue += Number(row.target_value) || 0;
        actualValue += Number(row.actual_value) || 0;
      }
      return {
        saleId: mapping.saleId,
        targetValue: round2(targetValue),
        actualValue: round2(actualValue),
        // Một sale nhiều slpCode: chỉ coi là có target khi ĐỦ tất cả các mã,
        // tránh cộng thiếu rồi kết luận trượt oan.
        hasTarget: !missing,
      };
    });
  }

  private async loadMonthlyBonus(
    saleIds: number[],
    months: string[],
  ): Promise<Map<number, { total: number; months: string[] }>> {
    const result = new Map<number, { total: number; months: string[] }>();
    if (saleIds.length === 0 || months.length === 0) return result;
    const rows = await this.monthlyRepo.find({
      where: {
        sale_id: In(saleIds),
        period_month: In(months),
      },
    });
    for (const row of rows) {
      const current = result.get(row.sale_id) ?? { total: 0, months: [] };
      current.total += Number(row.bonus_amount) || 0;
      current.months.push(row.period_month);
      result.set(row.sale_id, current);
    }
    return result;
  }

  private statusReason(
    status: KpiQuarterStatus,
    revenueSource: string,
  ): string | null {
    switch (status) {
      case KpiQuarterStatus.PENDING_DATA:
        return `Thiếu dữ liệu (${revenueSource})`;
      case KpiQuarterStatus.FAILED_REVENUE:
        return 'Không đạt doanh số quý';
      case KpiQuarterStatus.FAILED_KEY_COVERAGE:
        return 'Không phủ 100% khách KEY trong quý';
      case KpiQuarterStatus.FAILED_BOTH:
        return 'Không đạt cả doanh số và độ phủ khách KEY';
      default:
        return null;
    }
  }

  // ------------------------------------------------------------- monthly

  /**
   * Chỉ chính sale của dòng mới thấy `bonus_amount`; mọi role khác (kể cả
   * admin/pm/manager) nhận `null`.
   */
  private monthlyRowForView<T extends { sale_id: number }>(
    row: T,
    user: KpiUser,
  ): T {
    const self = this.scope.isSelf(user, row.sale_id);
    const result: T & { visibility: 'self' | 'outcome' } = {
      ...row,
      visibility: self ? 'self' : 'outcome',
    };
    if (!self) maskMonthlySalary(result);
    return result;
  }

  /** Quyết toán quý: lương luôn mask; doanh số theo công tắc full/percent. */
  private quarterRowForView<T extends { sale_id: number }>(
    row: T,
    user: KpiUser,
    mode: RevenueViewMode,
  ): T {
    const self = this.scope.isSelf(user, row.sale_id);
    const result: T & { visibility: 'self' | 'outcome' } = {
      ...row,
      visibility: self ? 'self' : 'outcome',
    };
    if (!self) maskQuarterRow(result, mode);
    return result;
  }

  async listMonthlyResults(
    query: { period?: string; saleId?: number },
    user: KpiUser,
  ): Promise<any> {
    const periodMonth = query.period ?? this.previousMonth();
    const userIds = await this.scope.scopeUserIds(user);
    if (query.saleId !== undefined) {
      this.scope.assertSaleInScope(query.saleId, userIds);
    }
    const where: FindOptionsWhere<KpiMonthlyResult> = {
      period_month: periodMonth,
    };
    if (query.saleId !== undefined) {
      where.sale_id = query.saleId;
    } else if (userIds !== undefined) {
      if (userIds.length === 0) {
        return { periodMonth, results: [] };
      }
      where.sale_id = In(userIds);
    }
    const rows = await this.monthlyRepo.find({
      where,
      order: { sale_id: 'ASC' },
    });
    const infos = await this.saleDirectory.loadSaleInfos(
      rows.map((row) => row.sale_id),
    );
    return {
      periodMonth,
      results: rows.map((row) =>
        this.monthlyRowForView(
          {
            ...row,
            saleName: infos.get(row.sale_id)?.fullName ?? null,
          },
          user,
        ),
      ),
    };
  }

  async setMonthlyBonus(
    id: number,
    body: { bonusAmount: number; reason?: string },
    user: KpiUser,
  ): Promise<any> {
    this.requireSalaryWriter(user);
    const row = await this.monthlyRepo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Không tìm thấy kết quả KPI tháng');
    }
    row.bonus_amount = round2(Number(body.bonusAmount) || 0);
    const snapshot = row.snapshot ?? {};
    row.snapshot = {
      ...snapshot,
      bonusUpdatedAt: new Date().toISOString(),
      bonusUpdatedBy: user.id ?? null,
      bonusNote: body.reason ?? null,
    };
    await this.monthlyRepo.save(row);
    // Write-only: không trả lại số thưởng để tránh lộ lương qua response.
    this.logger.log(
      `KPI tháng ${row.period_month}: cập nhật thưởng sale ${row.sale_id} bởi user ${user.id ?? 0}`,
    );
    return { id: row.id, updated: true };
  }

  async computeMonthlyResults(options: ComputeMonthlyOptions): Promise<any> {
    if (!options.system) this.requireWriter(options.user);
    const periodMonth = options.periodMonth || this.previousMonth();
    const range = this.monthRange(periodMonth);
    const targetRate = await this.getCoverageTargetRate();
    const { saleIds } = await this.resolveSaleIds(
      options.saleId,
      options.user,
      options.system,
    );
    if (saleIds.length === 0) {
      return { periodMonth, results: [] };
    }

    const infos = await this.saleDirectory.loadSaleInfos(saleIds);
    const mappings = await this.saleDirectory.loadMappings(saleIds, infos);
    const assignments = await this.loadAssignments(saleIds);
    const revenue = await this.loadRevenue(
      mappings.flatMap((mapping) => mapping.slpCodes),
      range.from,
      range.to,
    );
    const computed = computeMonthlyCoverage(
      assignments,
      revenue,
      mappings,
      targetRate,
    );

    const existingRows = await this.monthlyRepo.find({
      where: { period_month: periodMonth, sale_id: In(saleIds) },
    });
    const existingBySale = new Map(
      existingRows.map((row) => [row.sale_id, row]),
    );

    const toSave: KpiMonthlyResult[] = [];
    const savedMeta: number[] = [];
    const results: any[] = [];
    for (const saleId of saleIds) {
      const result = computed.get(saleId);
      if (!result) continue;
      const existing = existingBySale.get(saleId);
      // PENDING chưa phải snapshot chốt — cron được phép tính lại khi dữ liệu
      // (mapping NKM, doanh thu) đã về. PASSED/FAILED/EXEMPT mới giữ nguyên.
      const skipped =
        !!existing &&
        existing.status !== KpiMonthlyStatus.PENDING &&
        !options.force &&
        !options.reason;
      if (skipped) {
        results.push(
          this.monthlyRowForView(
            {
              ...existing,
              saleName: infos.get(saleId)?.fullName ?? null,
              skipped: true,
            },
            options.user,
          ),
        );
        continue;
      }

      const entity = existing ?? this.monthlyRepo.create();
      entity.sale_id = saleId;
      entity.period_month = periodMonth;
      entity.n_key = result.nKey;
      entity.covered_key = result.coveredKey;
      entity.coverage_rate = result.coverageRate;
      entity.target_rate = targetRate;
      entity.status = result.status;
      entity.bonus_amount = existing?.bonus_amount ?? null;
      entity.snapshot = this.monthlySnapshot(
        result,
        mappings,
        infos,
        periodMonth,
        range,
      );
      // Tính lại một tháng đã chốt phải có audit: ai, khi nào, lý do, số cũ.
      if (
        existing &&
        existing.status !== KpiMonthlyStatus.PENDING &&
        (options.force || options.reason)
      ) {
        const snapshot = entity.snapshot ?? {};
        const history: Array<Record<string, unknown>> = Array.isArray(
          snapshot.recomputeHistory,
        )
          ? (snapshot.recomputeHistory as Array<Record<string, unknown>>)
          : [];
        const entry = {
          at: new Date().toISOString(),
          by: options.user?.id ?? null,
          reason: options.reason ?? null,
          previous: {
            status: existing.status,
            nKey: existing.n_key,
            coveredKey: existing.covered_key,
            coverageRate: existing.coverage_rate,
            computedAt: existing.computed_at,
          },
        };
        entity.snapshot = {
          ...snapshot,
          lastRecompute: entry,
          recomputeHistory: [...history, entry].slice(-20),
        };
      }
      entity.computed_at = new Date();
      toSave.push(entity);
      savedMeta.push(saleId);
    }

    if (toSave.length > 0) {
      const saved = await this.monthlyRepo.save(toSave);
      const savedBySale = new Map(
        saved.map((entity) => [entity.sale_id, entity]),
      );
      for (const saleId of savedMeta) {
        const entity = savedBySale.get(saleId);
        if (!entity) continue;
        results.push(
          this.monthlyRowForView(
            {
              ...entity,
              saleName: infos.get(saleId)?.fullName ?? null,
              skipped: false,
            },
            options.user,
          ),
        );
      }
    }
    this.logger.log(
      `KPI tháng ${periodMonth}: tính ${toSave.length}/${saleIds.length} sale`,
    );
    return { periodMonth, results };
  }

  private monthlySnapshot(
    result: MonthlyCoverageResult,
    mappings: SaleSlpMapping[],
    infos: Map<number, KpiSaleInfo>,
    periodMonth: string,
    range: { from: string; to: string },
  ): Record<string, any> {
    const mapping = mappings.find((item) => item.saleId === result.saleId);
    return {
      saleId: result.saleId,
      saleName: infos.get(result.saleId)?.fullName ?? null,
      periodMonth,
      periodFrom: range.from,
      periodTo: range.to,
      slpCodes: mapping?.slpCodes ?? [],
      hasMapping: result.hasMapping,
      keyCustomerCodes: result.keyCodes,
      coveredCustomerCodes: result.coveredCodes,
      coverageRate: result.coverageRate,
      source: 'customer_revenue_daily',
      computedAt: new Date().toISOString(),
    };
  }

  // ------------------------------------------------------------- quarter

  async listQuarterSettlements(
    query: { fiscal_year?: number; quarter?: number; saleId?: number },
    user: KpiUser,
  ): Promise<any> {
    const quarter =
      query.fiscal_year && query.quarter
        ? fiscalQuarterRange(query.fiscal_year, query.quarter)
        : currentFiscalQuarter(vnToday());
    if (!quarter) {
      throw new BadRequestException('fiscal_year/quarter không hợp lệ');
    }
    const userIds = await this.scope.scopeUserIds(user);
    if (query.saleId !== undefined) {
      this.scope.assertSaleInScope(query.saleId, userIds);
    }
    const where: FindOptionsWhere<KpiQuarterlySettlement> = {
      fiscal_year: quarter.fiscalYear,
      quarter: quarter.quarter,
    };
    if (query.saleId !== undefined) {
      where.sale_id = query.saleId;
    } else if (userIds !== undefined) {
      if (userIds.length === 0) {
        return { quarter, results: [] };
      }
      where.sale_id = In(userIds);
    }
    const rows = await this.quarterRepo.find({
      where,
      order: { sale_id: 'ASC' },
    });
    const infos = await this.saleDirectory.loadSaleInfos(
      rows.map((row) => row.sale_id),
    );
    const revenueView = await this.revenueView.getMode();
    return {
      quarter,
      revenueView,
      results: rows.map((row) =>
        this.quarterRowForView(
          {
            ...row,
            saleName: infos.get(row.sale_id)?.fullName ?? null,
          },
          user,
          revenueView,
        ),
      ),
    };
  }

  async computeQuarterSettlements(
    options: ComputeQuarterOptions,
  ): Promise<any> {
    if (!options.system) this.requireWriter(options.user);
    const quarter = fiscalQuarterRange(options.fiscalYear, options.quarter);
    if (!quarter) {
      throw new BadRequestException('fiscal_year/quarter không hợp lệ');
    }
    const { saleIds } = await this.resolveSaleIds(
      options.saleId,
      options.user,
      options.system,
    );
    if (saleIds.length === 0) {
      return { quarter, results: [] };
    }

    const infos = await this.saleDirectory.loadSaleInfos(saleIds);
    const mappings = await this.saleDirectory.loadMappings(saleIds, infos);
    const assignments = await this.loadAssignments(saleIds);
    const revenue = await this.loadRevenue(
      mappings.flatMap((mapping) => mapping.slpCodes),
      quarter.from,
      quarter.to,
    );
    const targets = await this.loadQuarterTargets(mappings, quarter);
    const computed = computeQuarterSettlement(
      assignments,
      revenue,
      mappings,
      targets,
    );

    const months = fiscalQuarterMonths(quarter.fiscalYear, quarter.quarter);
    const bonusMonths = months.slice(0, 2);
    const bonuses = await this.loadMonthlyBonus(saleIds, bonusMonths);

    const existingRows = await this.quarterRepo.find({
      where: {
        fiscal_year: quarter.fiscalYear,
        quarter: quarter.quarter,
        sale_id: In(saleIds),
      },
    });
    const existingBySale = new Map(
      existingRows.map((row) => [row.sale_id, row]),
    );

    const toSave: KpiQuarterlySettlement[] = [];
    const savedMeta: number[] = [];
    const results: any[] = [];
    const revenueView = await this.revenueView.getMode();
    for (const saleId of saleIds) {
      const result = computed.get(saleId);
      if (!result) continue;
      const existing = existingBySale.get(saleId);
      if (existing?.is_final) {
        if (options.skipFinalized) {
          results.push(
            this.quarterRowForView(
              {
                ...existing,
                saleName: infos.get(saleId)?.fullName ?? null,
                skipped: true,
              },
              options.user,
              revenueView,
            ),
          );
          continue;
        }
        throw new BadRequestException(
          `Quý ${quarter.label} của sale ${saleId} đã chốt; hãy reopen trước khi tính lại`,
        );
      }

      const bonus = bonuses.get(saleId) ?? { total: 0, months: [] };
      const failed = [
        KpiQuarterStatus.FAILED_REVENUE,
        KpiQuarterStatus.FAILED_KEY_COVERAGE,
        KpiQuarterStatus.FAILED_BOTH,
      ].includes(result.status);

      const entity = existing ?? this.quarterRepo.create();
      entity.sale_id = saleId;
      entity.fiscal_year = quarter.fiscalYear;
      entity.quarter = quarter.quarter;
      entity.target_value = result.targetValue;
      entity.actual_revenue = result.actualRevenue;
      entity.n_key = result.nKey;
      entity.covered_key = result.coveredKey;
      entity.key_coverage_rate = result.keyCoverageRate;
      entity.revenue_achieved = result.revenueAchieved;
      entity.key_achieved = result.keyAchieved;
      entity.status = result.status;
      entity.monthly_bonus_total = round2(bonus.total);
      entity.clawback_amount = failed ? round2(bonus.total) : 0;
      entity.reason = this.statusReason(result.status, result.revenueSource);
      entity.snapshot = {
        saleId,
        saleName: infos.get(saleId)?.fullName ?? null,
        quarter: quarter.label,
        periodFrom: quarter.from,
        periodTo: quarter.to,
        slpCodes:
          mappings.find((item) => item.saleId === saleId)?.slpCodes ?? [],
        targetValue: result.targetValue,
        actualRevenue: result.actualRevenue,
        revenueSource: result.revenueSource,
        revenueAchieved: result.revenueAchieved,
        keyAchieved: result.keyAchieved,
        keyCustomerCodes: result.keyCodes,
        coveredCustomerCodes: result.coveredCodes,
        keyCoverageRate: result.keyCoverageRate,
        monthlyBonusMonths: bonus.months,
        computeNote: options.reason ?? null,
        computeBy: options.user?.id ?? null,
        computedAt: new Date().toISOString(),
      };
      entity.computed_at = new Date();
      toSave.push(entity);
      savedMeta.push(saleId);
    }

    if (toSave.length > 0) {
      const saved = await this.quarterRepo.save(toSave);
      const savedBySale = new Map(
        saved.map((entity) => [entity.sale_id, entity]),
      );
      for (const saleId of savedMeta) {
        const entity = savedBySale.get(saleId);
        if (!entity) continue;
        results.push(
          this.quarterRowForView(
            {
              ...entity,
              saleName: infos.get(saleId)?.fullName ?? null,
              skipped: false,
            },
            options.user,
            revenueView,
          ),
        );
      }
    }
    this.logger.log(
      `KPI ${quarter.label}: tính ${toSave.length}/${saleIds.length} sale`,
    );
    return { quarter, revenueView, results };
  }

  async finalizeQuarterSettlement(
    body: { fiscalYear: number; quarter: number; saleId: number },
    user: KpiUser,
  ): Promise<any> {
    this.requireFinalApprover(user);
    const quarter = fiscalQuarterRange(body.fiscalYear, body.quarter);
    if (!quarter)
      throw new BadRequestException('fiscal_year/quarter không hợp lệ');
    const settlement = await this.quarterRepo.findOne({
      where: {
        sale_id: body.saleId,
        fiscal_year: quarter.fiscalYear,
        quarter: quarter.quarter,
      },
    });
    if (!settlement) {
      throw new NotFoundException('Không tìm thấy settlement của sale/quý');
    }
    if (settlement.status === KpiQuarterStatus.PENDING_DATA) {
      throw new BadRequestException(
        'Settlement còn thiếu dữ liệu (PENDING_DATA), chưa thể chốt',
      );
    }
    settlement.is_final = true;
    settlement.finalized_at = new Date();
    settlement.finalized_by = user?.id ?? null;
    const revenueView = await this.revenueView.getMode();
    return this.quarterRowForView(
      await this.quarterRepo.save(settlement),
      user,
      revenueView,
    );
  }

  async reopenQuarterSettlement(
    body: {
      fiscalYear: number;
      quarter: number;
      saleId: number;
      reason?: string;
    },
    user: KpiUser,
  ): Promise<any> {
    this.requireFinalApprover(user);
    const quarter = fiscalQuarterRange(body.fiscalYear, body.quarter);
    if (!quarter)
      throw new BadRequestException('fiscal_year/quarter không hợp lệ');
    const settlement = await this.quarterRepo.findOne({
      where: {
        sale_id: body.saleId,
        fiscal_year: quarter.fiscalYear,
        quarter: quarter.quarter,
      },
    });
    if (!settlement) {
      throw new NotFoundException('Không tìm thấy settlement của sale/quý');
    }
    const snapshot = settlement.snapshot ?? {};
    const history = Array.isArray(snapshot.reopenHistory)
      ? snapshot.reopenHistory
      : [];
    history.push({
      at: new Date().toISOString(),
      by: user?.id ?? null,
      reason: body.reason ?? null,
    });
    settlement.snapshot = { ...snapshot, reopenHistory: history };
    settlement.is_final = false;
    settlement.finalized_at = null;
    settlement.finalized_by = null;
    const revenueView = await this.revenueView.getMode();
    return this.quarterRowForView(
      await this.quarterRepo.save(settlement),
      user,
      revenueView,
    );
  }

  // -------------------------------------------------------- daily tracking

  async dailyTracking(query: DailyTrackingQuery): Promise<any> {
    const userIds = await this.scope.scopeUserIds(query.user);
    const saleId =
      query.saleId ??
      (userIds !== undefined && userIds.length === 1 ? userIds[0] : undefined);
    if (!saleId) {
      throw new BadRequestException('saleId là bắt buộc');
    }
    this.scope.assertSaleInScope(saleId, userIds);

    const quarter =
      query.fiscal_year && query.quarter
        ? fiscalQuarterRange(query.fiscal_year, query.quarter)
        : currentFiscalQuarter(vnToday());
    if (!quarter) {
      throw new BadRequestException('fiscal_year/quarter không hợp lệ');
    }

    const infos = await this.saleDirectory.loadSaleInfos([saleId]);
    const mappings = await this.saleDirectory.loadMappings([saleId], infos);
    const slpCodes = mappings[0]?.slpCodes ?? [];
    const targets = await this.loadQuarterTargets(mappings, quarter);
    const target = targets[0]?.targetValue ?? 0;

    let actual = 0;
    let dataThrough: string | null = null;
    let provisionalDates: string[] = [];
    if (slpCodes.length > 0) {
      const totalRow = await this.revenueRepo
        .createQueryBuilder('r')
        .select('SUM(r.line_total)', 'total')
        .addSelect('MAX(r.stat_date)', 'dataThrough')
        .where('r.slp_code IN (:...slp)', { slp: slpCodes })
        .andWhere('r.stat_date >= :from', { from: quarter.from })
        .andWhere('r.stat_date <= :to', { to: quarter.to })
        .getRawOne<{ total: string; dataThrough: string | null }>();
      actual = Number(totalRow?.total) || 0;
      dataThrough = totalRow?.dataThrough ?? null;

      const rows = await this.revenueRepo
        .createQueryBuilder('r')
        .select('DISTINCT r.stat_date', 'statDate')
        .where('r.slp_code IN (:...slp)', { slp: slpCodes })
        .andWhere('r.stat_date >= :from', { from: quarter.from })
        .andWhere('r.stat_date <= :to', { to: quarter.to })
        .andWhere('r.is_provisional = :provisional', { provisional: true })
        .orderBy('r.stat_date', 'ASC')
        .getRawMany<{ statDate: string }>();
      provisionalDates = rows.map((row) => row.statDate);
    }

    const today = vnToday();
    const totalWorkingDays = await this.workingDays.countWorkingDays(
      quarter.from,
      quarter.to,
    );
    const elapsedTo = today > quarter.to ? quarter.to : shiftDateStr(today, -1);
    const elapsedWorkingDays =
      elapsedTo >= quarter.from
        ? await this.workingDays.countWorkingDays(quarter.from, elapsedTo)
        : 0;
    const remainingFrom = today > quarter.from ? today : quarter.from;
    const remainingWorkingDays =
      remainingFrom <= quarter.to
        ? await this.workingDays.countWorkingDays(remainingFrom, quarter.to)
        : 0;

    const expectedToDate =
      totalWorkingDays > 0
        ? round2(target * (elapsedWorkingDays / totalWorkingDays))
        : 0;
    const remainingTarget = Math.max(0, target - actual);
    const dailyTarget =
      remainingWorkingDays > 0
        ? round2(remainingTarget / remainingWorkingDays)
        : 0;

    let status: string;
    if (target <= 0) {
      status = 'no_target';
    } else if (totalWorkingDays === 0) {
      status = 'no_calendar';
    } else if (today < quarter.from) {
      status = 'not_started';
    } else if (today > quarter.to) {
      status = actual >= target ? 'finished_pass' : 'finished_fail';
    } else if (expectedToDate === 0 && actual === 0) {
      status = 'on_track';
    } else if (actual >= expectedToDate) {
      status = 'ahead';
    } else if (expectedToDate > 0 && actual < expectedToDate * 0.9) {
      status = 'lagging';
    } else {
      status = 'on_track';
    }

    const self = this.scope.isSelf(query.user, saleId);
    const revenueView = await this.revenueView.getMode();
    const response: Record<string, any> = {
      saleId,
      saleName: infos.get(saleId)?.fullName ?? null,
      slpCodes,
      quarter,
      target,
      actual: round2(actual),
      remainingTarget,
      totalWorkingDays,
      elapsedWorkingDays,
      remainingWorkingDays,
      expectedToDate,
      dailyTarget,
      status,
      dataThrough,
      provisionalDates,
      targetSource: 'sale_revenue_target',
      actualSource: 'customer_revenue_daily',
      today,
      visibility: self ? 'self' : 'outcome',
      revenueView,
    };
    // Thêm achievedPct; chỉ mask số tuyệt đối khi outcome + percent.
    maskDailyTracking(response, self ? 'full' : revenueView);
    return response;
  }

  // ---------------------------------------------------------------- cron

  /** Cron tháng: chốt tháng trước cho toàn bộ sale trong phạm vi. */
  async runMonthlyCron(): Promise<void> {
    const periodMonth = this.previousMonth();
    await this.computeMonthlyResults({
      periodMonth,
      user: { id: 0, roles: ['admin'] },
      force: false,
      system: true,
    });
  }

  /**
   * Cron quý: recompute quý vừa kết thúc trong 10 ngày đầu quý sau.
   * Bỏ qua settlement đã final.
   */
  async runQuarterCron(): Promise<void> {
    const today = vnToday();
    const day = Number(today.slice(8, 10));
    const month = Number(today.slice(5, 7));
    if (day > QUARTER_RECOMPUTE_DAYS) return;
    if (![1, 4, 7, 10].includes(month)) return;
    const quarter = previousFiscalQuarter(today);
    if (!quarter) return;
    await this.computeQuarterSettlements({
      fiscalYear: quarter.fiscalYear,
      quarter: quarter.quarter,
      user: { id: 0, roles: ['admin'] },
      force: false,
      skipFinalized: true,
      system: true,
    });
  }
}

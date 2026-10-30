import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { RedisService } from '../common/cache/redis.service';
import { OrderBlacklistService } from '../order-blacklist/order-blacklist.service';
import { OrderService } from '../orders/order.service';
import { CareStatsQueryDto } from './dto/order-care.dto';

interface DateRange {
  from: Date;
  to: Date;
  normalizedPeriod: 'day' | 'week' | 'month' | 'quarter' | 'custom';
}

interface OrderStatsRow {
  status: string;
  is_project: number | string;
  care_count: number | string;
  sale_by: number | string;
  full_name: string | null;
  bucket: string;
  c: number | string;
}

interface CareTimelineRow {
  bucket: string;
  careActions: number | string;
  ordersCared: number | string;
  careBatches: number | string;
}

interface CompletionRow {
  bucket: string;
  completedFromCare: number | string;
}

interface TimelineEntry {
  bucket: string;
  orders: number;
  unclosed: number;
  cared: number;
  careActions: number;
  ordersCared: number;
  careBatches: number;
  completedFromCare: number;
}

/** Tăng key này khi có dữ liệu chăm sóc mới để bỏ cache thống kê. */
export const ORDER_CARE_STATS_CACHE_VERSION_KEY = 'order-care:stats:version';

const STATS_CACHE_PREFIX = 'order-care:stats:overview';
const STATS_CACHE_TTL_SECONDS = 60;
/**
 * Bảng order_details gần 600k dòng/3.9GB. Optimizer của MySQL 8 ước lượng sai
 * và chọn join từ orders rồi tra từng dòng (3.2s/query); ép covering index đưa
 * mỗi query về ~100ms.
 */
const STATS_INDEX_HINT = 'FORCE INDEX (idx_od_stats_cover)';

@Injectable()
export class OrderCareStatsService {
  private readonly logger = new Logger(OrderCareStatsService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly orderService: OrderService,
    private readonly orderBlacklistService: OrderBlacklistService,
    private readonly redisService: RedisService,
  ) {}

  async getOverview(user: any, query: CareStatsQueryDto) {
    const range = this.getDateRange(
      query.period || 'month',
      query.date,
      query.dateFrom,
      query.dateTo,
    );
    const scope = query.scope === 'all' ? 'all' : 'created';
    const isProject = query.isProject || '0';

    const allowedUserIds = await this.orderService.getUserIdsByRole(user);
    const employees = this.parseCsvNumbers(query.employees);
    const departments = this.parseCsvNumbers(query.departments);
    const blacklist = await this.resolveBlacklist(user, allowedUserIds);

    const cacheKey = await this.buildCacheKey(
      user,
      query,
      scope,
      isProject,
      allowedUserIds,
      employees,
      departments,
      blacklist,
    );
    const cached = await this.redisService.get<any>(cacheKey);
    if (cached) return cached;

    const sharedFilterOptions = {
      allowedUserIds,
      employees,
      departments,
      blacklist,
      isProject,
    };

    const orderFilters = this.buildFilters({
      ...sharedFilterOptions,
      dateColumn: scope === 'created' ? 'od.created_at' : undefined,
      from: range.from,
      to: range.to,
    });
    const careFilters = this.buildFilters({
      ...sharedFilterOptions,
      dateColumn: 'ci.cared_at',
      from: range.from,
      to: range.to,
    });
    // Query hoàn tất tự lọc theo sh.changed_at nên chỉ cần các filter chung.
    const completionFilters = this.buildFilters(sharedFilterOptions);

    const bucketFormat = this.isMonthlyBucket(range) ? '%Y-%m' : '%Y-%m-%d';

    const [orderRows, careTotalsRows, careTimelineRows, completionRows] =
      await Promise.all([
        this.queryOrderStats(
          `SELECT od.status AS status,
                  od.is_project AS is_project,
                  od.care_count AS care_count,
                  o.sale_by AS sale_by,
                  u.full_name AS full_name,
                  DATE_FORMAT(od.created_at, ?) AS bucket,
                  COUNT(*) AS c
           FROM order_details od ${STATS_INDEX_HINT}
           INNER JOIN orders o ON o.id = od.order_id
           INNER JOIN users u ON u.id = o.sale_by
           WHERE 1 = 1 ${orderFilters.sql}
           GROUP BY od.status, od.is_project, od.care_count, o.sale_by, u.full_name, bucket`,
          [bucketFormat, ...orderFilters.params],
        ),
        this.dataSource.query(
          `SELECT COUNT(*) AS careActions,
                  COUNT(DISTINCT ci.order_detail_id) AS ordersCaredInPeriod,
                  COUNT(DISTINCT ci.batch_id) AS careBatches
           FROM order_care_items ci
           INNER JOIN order_details od ON od.id = ci.order_detail_id
           INNER JOIN orders o ON o.id = od.order_id
           WHERE 1 = 1 ${careFilters.sql}`,
          careFilters.params,
        ),
        this.dataSource.query(
          `SELECT DATE_FORMAT(ci.cared_at, ?) AS bucket,
                  COUNT(*) AS careActions,
                  COUNT(DISTINCT ci.order_detail_id) AS ordersCared,
                  COUNT(DISTINCT ci.batch_id) AS careBatches
           FROM order_care_items ci
           INNER JOIN order_details od ON od.id = ci.order_detail_id
           INNER JOIN orders o ON o.id = od.order_id
           WHERE 1 = 1 ${careFilters.sql}
           GROUP BY bucket
           ORDER BY bucket ASC`,
          [bucketFormat, ...careFilters.params],
        ),
        this.dataSource.query(
          `SELECT DATE_FORMAT(sh.changed_at, ?) AS bucket,
                  COUNT(DISTINCT sh.order_detail_id) AS completedFromCare
           FROM order_status_histories sh
           INNER JOIN order_details od ON od.id = sh.order_detail_id
           INNER JOIN orders o ON o.id = od.order_id
           WHERE sh.to_status IN ('completed')
             AND sh.changed_at BETWEEN ? AND ?
             AND EXISTS (
               SELECT 1 FROM order_care_items ci
               WHERE ci.order_detail_id = od.id AND ci.cared_at <= sh.changed_at
             )
             ${completionFilters.sql}
           GROUP BY bucket
           ORDER BY bucket ASC`,
          [bucketFormat, range.from, range.to, ...completionFilters.params],
        ),
      ]);

    const result = this.assembleOverview(
      range,
      scope,
      isProject,
      orderRows || [],
      careTotalsRows?.[0] || {},
      careTimelineRows || [],
      completionRows || [],
    );

    await this.redisService.set(cacheKey, result, STATS_CACHE_TTL_SECONDS);
    return result;
  }

  private assembleOverview(
    range: DateRange,
    scope: string,
    isProject: string,
    orderRows: OrderStatsRow[],
    careTotalsRow: any,
    careTimelineRows: CareTimelineRow[],
    completionRows: CompletionRow[],
  ) {
    const totals = {
      orders: 0,
      unclosedOrders: 0,
      quotedOrders: 0,
      caredOrders: 0,
      ordersCaredInPeriod: this.num(careTotalsRow.ordersCaredInPeriod),
      uncaredUnclosedOrders: 0,
      careActions: this.num(careTotalsRow.careActions),
      careBatches: this.num(careTotalsRow.careBatches),
      careCountLifetime: 0,
      completedOrders: 0,
      completedFromCare: 0,
      rejectedFromCare: 0,
      demandOrders: 0,
      rejectedOrders: 0,
    };

    const statusMap = new Map<
      string,
      { status: string; count: number; careCount: number }
    >();
    const saleMap = new Map<
      number,
      {
        userId: number;
        fullName: string | null;
        orders: number;
        unclosed: number;
        cared: number;
        careActions: number;
        completedFromCare: number;
      }
    >();
    const projectMap = new Map<
      boolean,
      {
        isProject: boolean;
        orders: number;
        cared: number;
        careActions: number;
        completedFromCare: number;
      }
    >();
    const turnMap = new Map<number, number>();
    const timelineMap = new Map<string, TimelineEntry>();

    for (const row of orderRows) {
      const count = this.num(row.c);
      const careCount = Math.max(0, this.num(row.care_count));
      const status = row.status;
      const isProjectRow = !!Number(row.is_project);
      const userId = this.num(row.sale_by);
      const careActions = count * careCount;
      const isUnclosed = status === 'quoted' || status === 'cared';

      totals.orders += count;
      totals.careCountLifetime += careActions;
      if (isUnclosed) totals.unclosedOrders += count;
      if (status === 'quoted') totals.quotedOrders += count;
      if (careCount > 0) totals.caredOrders += count;
      if (isUnclosed && careCount === 0) totals.uncaredUnclosedOrders += count;
      if (careCount > 0 && status === 'completed')
        totals.completedFromCare += count;
      if (careCount > 0 && status === 'rejected')
        totals.rejectedFromCare += count;
      if (status === 'completed') totals.completedOrders += count;
      if (status === 'demand') totals.demandOrders += count;
      if (status === 'rejected') totals.rejectedOrders += count;

      const statusEntry = statusMap.get(status) || {
        status,
        count: 0,
        careCount: 0,
      };
      statusEntry.count += count;
      statusEntry.careCount += careActions;
      statusMap.set(status, statusEntry);

      let saleEntry = saleMap.get(userId);
      if (!saleEntry) {
        saleEntry = {
          userId,
          fullName: row.full_name || null,
          orders: 0,
          unclosed: 0,
          cared: 0,
          careActions: 0,
          completedFromCare: 0,
        };
        saleMap.set(userId, saleEntry);
      }
      saleEntry.orders += count;
      if (isUnclosed) saleEntry.unclosed += count;
      if (careCount > 0) saleEntry.cared += count;
      saleEntry.careActions += careActions;
      if (careCount > 0 && status === 'completed')
        saleEntry.completedFromCare += count;

      let projectEntry = projectMap.get(isProjectRow);
      if (!projectEntry) {
        projectEntry = {
          isProject: isProjectRow,
          orders: 0,
          cared: 0,
          careActions: 0,
          completedFromCare: 0,
        };
        projectMap.set(isProjectRow, projectEntry);
      }
      projectEntry.orders += count;
      if (careCount > 0) projectEntry.cared += count;
      projectEntry.careActions += careActions;
      if (careCount > 0 && status === 'completed')
        projectEntry.completedFromCare += count;

      turnMap.set(careCount, (turnMap.get(careCount) || 0) + count);

      const timelineEntry = this.getTimelineEntry(timelineMap, row.bucket);
      timelineEntry.orders += count;
      if (isUnclosed) timelineEntry.unclosed += count;
      if (careCount > 0) timelineEntry.cared += count;
    }

    for (const row of careTimelineRows) {
      const entry = this.getTimelineEntry(timelineMap, row.bucket);
      entry.careActions = this.num(row.careActions);
      entry.ordersCared = this.num(row.ordersCared);
      entry.careBatches = this.num(row.careBatches);
    }
    for (const row of completionRows) {
      const entry = this.getTimelineEntry(timelineMap, row.bucket);
      entry.completedFromCare = this.num(row.completedFromCare);
    }

    const careCoverageDenominator =
      totals.caredOrders + totals.uncaredUnclosedOrders;
    const careCoverageRate = careCoverageDenominator
      ? totals.caredOrders / careCoverageDenominator
      : 0;
    const careConversionRate = totals.caredOrders
      ? totals.completedFromCare / totals.caredOrders
      : 0;

    return {
      period: {
        period: range.normalizedPeriod,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      scope: { isProject, mode: scope },
      totals: {
        ...totals,
        careCoverageRate,
        careConversionRate,
      },
      byStatus: Array.from(statusMap.values()),
      careTurnDistribution: this.buildTurnDistribution(turnMap),
      timeline: Array.from(timelineMap.values()).sort((a, b) =>
        a.bucket.localeCompare(b.bucket),
      ),
      bySale: Array.from(saleMap.values()).sort(
        (a, b) => b.cared - a.cared || b.orders - a.orders,
      ),
      byProject: Array.from(projectMap.values()),
    };
  }

  private getTimelineEntry(
    map: Map<string, TimelineEntry>,
    bucket: string,
  ): TimelineEntry {
    if (!map.has(bucket)) {
      map.set(bucket, {
        bucket,
        orders: 0,
        unclosed: 0,
        cared: 0,
        careActions: 0,
        ordersCared: 0,
        careBatches: 0,
        completedFromCare: 0,
      });
    }
    return map.get(bucket)!;
  }

  private isMonthlyBucket(range: DateRange): boolean {
    return (
      range.normalizedPeriod === 'quarter' ||
      range.normalizedPeriod === 'month' ||
      (range.normalizedPeriod === 'custom' &&
        range.to.getTime() - range.from.getTime() > 62 * 24 * 60 * 60 * 1000)
    );
  }

  private async queryOrderStats(sql: string, params: any[]) {
    try {
      return await this.dataSource.query(sql, params);
    } catch (error) {
      if (error?.errno !== 1176 && error?.code !== 'ER_KEY_DOES_NOT_EXIST') {
        throw error;
      }
      // DB chưa có index (môi trường mới trước lần synchronize đầu tiên):
      // chạy lại không hint để endpoint vẫn trả được số liệu.
      this.logger.warn(
        'idx_od_stats_cover chưa tồn tại, chạy lại query không FORCE INDEX',
      );
      return this.dataSource.query(sql.replace(STATS_INDEX_HINT, ''), params);
    }
  }

  private async buildCacheKey(
    user: any,
    query: CareStatsQueryDto,
    scope: string,
    isProject: string,
    allowedUserIds: number[] | null,
    employees: number[],
    departments: number[],
    blacklist: string[],
  ): Promise<string> {
    const version =
      (await this.redisService.get<string>(
        ORDER_CARE_STATS_CACHE_VERSION_KEY,
      )) || '0';
    const signature = createHash('sha1')
      .update(
        JSON.stringify({
          user: user?.id ?? null,
          period: query.period ?? null,
          date: query.date ?? null,
          dateFrom: query.dateFrom ?? null,
          dateTo: query.dateTo ?? null,
          isProject,
          scope,
          employees,
          departments,
          allowedUserIds,
          blacklist,
        }),
      )
      .digest('hex');
    return `${STATS_CACHE_PREFIX}:${version}:${signature}`;
  }

  private buildTurnDistribution(buckets: Map<number, number>) {
    const result: { careCount: number; orders: number; isPlus: boolean }[] = [];
    for (let i = 0; i <= 5; i += 1) {
      let orders = buckets.get(i) || 0;
      if (i === 5) {
        for (const [careCount, count] of buckets) {
          if (careCount > 5) orders += count;
        }
      }
      result.push({
        careCount: i,
        orders,
        isPlus: i === 5,
      });
    }
    return result;
  }

  private buildFilters(options: {
    dateColumn?: string;
    from?: Date;
    to?: Date;
    allowedUserIds: number[] | null;
    employees: number[];
    departments: number[];
    blacklist: string[];
    isProject: string;
  }): { sql: string; params: any[] } {
    const clauses: string[] = ['AND od.deleted_at IS NULL'];
    const params: any[] = [];

    if (options.isProject === '1') {
      clauses.push('AND od.is_project = 1');
    } else if (options.isProject === '0') {
      clauses.push('AND od.is_project = 0');
    }

    if (options.dateColumn && options.from && options.to) {
      clauses.push(`AND ${options.dateColumn} BETWEEN ? AND ?`);
      params.push(options.from, options.to);
    }

    if (options.allowedUserIds !== null) {
      if (options.allowedUserIds.length === 0) {
        clauses.push('AND 1 = 0');
      } else {
        clauses.push(
          `AND o.sale_by IN (${options.allowedUserIds
            .map(() => '?')
            .join(',')})`,
        );
        params.push(...options.allowedUserIds);
      }
    }

    if (options.employees.length > 0) {
      clauses.push(
        `AND o.sale_by IN (${options.employees.map(() => '?').join(',')})`,
      );
      params.push(...options.employees);
    }

    if (options.departments.length > 0) {
      clauses.push(
        `AND EXISTS (
          SELECT 1 FROM users_departments ud
          INNER JOIN departments d ON d.id = ud.department_id
          WHERE ud.user_id = o.sale_by
            AND d.id IN (${options.departments.map(() => '?').join(',')})
        )`,
      );
      params.push(...options.departments);
    }

    if (options.blacklist.length > 0) {
      clauses.push(
        `AND (od.meta_customer_id IS NULL OR od.meta_customer_id NOT IN (${options.blacklist
          .map(() => '?')
          .join(',')}))`,
      );
      params.push(...options.blacklist);
    }

    return { sql: ` ${clauses.join(' ')}`, params };
  }

  private async resolveBlacklist(
    user: any,
    allowedUserIds: number[] | null,
  ): Promise<string[]> {
    const roleNames = (user?.roles || []).map((r: any) =>
      typeof r === 'string' ? r.toLowerCase() : (r.name || '').toLowerCase(),
    );
    if (roleNames.includes('admin')) return [];

    const ids = allowedUserIds && allowedUserIds.length ? allowedUserIds : [user?.id];
    const validIds = ids.filter((id) => !!id);
    if (validIds.length === 0) return [];

    const map =
      await this.orderBlacklistService.getBlacklistedContactsForUsers(validIds);
    const merged = new Set<string>();
    for (const set of map.values()) {
      for (const value of set) merged.add(value);
    }
    return Array.from(merged);
  }

  private parseCsvNumbers(csv?: string): number[] {
    if (!csv) return [];
    return csv
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item) && item > 0);
  }

  private num(value: any): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  private endOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  private startOfWeekMonday(d: Date): Date {
    const date = this.startOfDay(d);
    const day = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - day);
    return date;
  }

  private endOfWeekSunday(d: Date): Date {
    const start = this.startOfWeekMonday(d);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return this.endOfDay(end);
  }

  private startOfMonth(d: Date): Date {
    return this.startOfDay(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  private endOfMonth(d: Date): Date {
    return this.endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }

  private startOfQuarter(d: Date): Date {
    const q = Math.floor(d.getMonth() / 3);
    return this.startOfDay(new Date(d.getFullYear(), q * 3, 1));
  }

  private endOfQuarter(d: Date): Date {
    const start = this.startOfQuarter(d);
    return this.endOfDay(
      new Date(start.getFullYear(), start.getMonth() + 3, 0),
    );
  }

  private getDateRange(
    period: string,
    date?: string,
    dateFrom?: string,
    dateTo?: string,
  ): DateRange {
    const today = new Date();
    const p = (period || 'day').toLowerCase();

    if (p === 'custom' && dateFrom && dateTo) {
      const from = this.startOfDay(new Date(dateFrom));
      const to = this.endOfDay(new Date(dateTo));
      return { from, to, normalizedPeriod: 'custom' };
    }

    const target = date ? new Date(date) : today;
    switch (p) {
      case 'week': {
        const from = this.startOfWeekMonday(target);
        const to = this.endOfWeekSunday(target);
        return { from, to, normalizedPeriod: 'week' };
      }
      case 'month': {
        const from = this.startOfMonth(target);
        const to = this.endOfMonth(target);
        return { from, to, normalizedPeriod: 'month' };
      }
      case 'quarter': {
        const from = this.startOfQuarter(target);
        const to = this.endOfQuarter(target);
        return { from, to, normalizedPeriod: 'quarter' };
      }
      case 'day':
      default: {
        const from = this.startOfDay(target);
        const to = this.endOfDay(target);
        return { from, to, normalizedPeriod: 'day' };
      }
    }
  }
}

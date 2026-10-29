import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrderBlacklistService } from '../order-blacklist/order-blacklist.service';
import { OrderService } from '../orders/order.service';
import { CareStatsQueryDto } from './dto/order-care.dto';

interface DateRange {
  from: Date;
  to: Date;
  normalizedPeriod: 'day' | 'week' | 'month' | 'quarter' | 'custom';
}

@Injectable()
export class OrderCareStatsService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly orderService: OrderService,
    private readonly orderBlacklistService: OrderBlacklistService,
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

    const orderFilters = this.buildFilters({
      dateColumn: scope === 'created' ? 'od.created_at' : undefined,
      from: range.from,
      to: range.to,
      allowedUserIds,
      employees,
      departments,
      blacklist,
      isProject,
    });

    const careFilters = this.buildFilters({
      dateColumn: 'ci.cared_at',
      from: range.from,
      to: range.to,
      allowedUserIds,
      employees,
      departments,
      blacklist,
      isProject,
    });

    const orderFrom = `
      FROM order_details od
      INNER JOIN orders o ON o.id = od.order_id
      INNER JOIN users u ON u.id = o.sale_by
    `;

    const careFrom = `
      FROM order_care_items ci
      INNER JOIN order_details od ON od.id = ci.order_detail_id
      INNER JOIN orders o ON o.id = od.order_id
      INNER JOIN users u ON u.id = o.sale_by
    `;

    const [totalsRows, careRows, byStatusRows, turnRows, bySaleRows, byProjectRows] =
      await Promise.all([
        this.dataSource.query(
          `SELECT
             COUNT(*) AS orders,
             SUM(CASE WHEN od.status IN ('quoted','cared') THEN 1 ELSE 0 END) AS unclosedOrders,
             SUM(CASE WHEN od.status = 'quoted' THEN 1 ELSE 0 END) AS quotedOrders,
             SUM(CASE WHEN od.care_count > 0 THEN 1 ELSE 0 END) AS caredOrders,
             SUM(CASE WHEN od.status IN ('quoted','cared') AND od.care_count = 0 THEN 1 ELSE 0 END) AS uncaredUnclosedOrders,
             SUM(CASE WHEN od.care_count > 0 AND od.status = 'completed' THEN 1 ELSE 0 END) AS completedFromCare,
             SUM(CASE WHEN od.care_count > 0 AND od.status = 'rejected' THEN 1 ELSE 0 END) AS rejectedFromCare,
             SUM(CASE WHEN od.status = 'completed' THEN 1 ELSE 0 END) AS completedOrders,
             SUM(CASE WHEN od.status = 'demand' THEN 1 ELSE 0 END) AS demandOrders,
             SUM(CASE WHEN od.status = 'rejected' THEN 1 ELSE 0 END) AS rejectedOrders,
             SUM(od.care_count) AS careCountLifetime
           ${orderFrom}
           WHERE 1 = 1 ${orderFilters.sql}`,
          orderFilters.params,
        ),
        this.dataSource.query(
          `SELECT
             COUNT(*) AS careActions,
             COUNT(DISTINCT ci.order_detail_id) AS ordersCaredInPeriod,
             COUNT(DISTINCT ci.batch_id) AS careBatches
           ${careFrom}
           WHERE 1 = 1 ${careFilters.sql}`,
          careFilters.params,
        ),
        this.dataSource.query(
          `SELECT od.status AS status,
                  COUNT(*) AS count,
                  SUM(od.care_count) AS careCount
           ${orderFrom}
           WHERE 1 = 1 ${orderFilters.sql}
           GROUP BY od.status`,
          orderFilters.params,
        ),
        this.dataSource.query(
          `SELECT od.care_count AS careCount, COUNT(*) AS orders
           ${orderFrom}
           WHERE 1 = 1 ${orderFilters.sql}
           GROUP BY od.care_count
           ORDER BY od.care_count ASC`,
          orderFilters.params,
        ),
        this.dataSource.query(
          `SELECT o.sale_by AS userId,
                  u.full_name AS fullName,
                  COUNT(*) AS orders,
                  SUM(CASE WHEN od.status IN ('quoted','cared') THEN 1 ELSE 0 END) AS unclosed,
                  SUM(CASE WHEN od.care_count > 0 THEN 1 ELSE 0 END) AS cared,
                  SUM(od.care_count) AS careActions,
                  SUM(CASE WHEN od.care_count > 0 AND od.status = 'completed' THEN 1 ELSE 0 END) AS completedFromCare
           ${orderFrom}
           WHERE 1 = 1 ${orderFilters.sql}
           GROUP BY o.sale_by, u.full_name
           ORDER BY cared DESC, orders DESC`,
          orderFilters.params,
        ),
        this.dataSource.query(
          `SELECT od.is_project AS isProject,
                  COUNT(*) AS orders,
                  SUM(CASE WHEN od.care_count > 0 THEN 1 ELSE 0 END) AS cared,
                  SUM(od.care_count) AS careActions,
                  SUM(CASE WHEN od.care_count > 0 AND od.status = 'completed' THEN 1 ELSE 0 END) AS completedFromCare
           ${orderFrom}
           WHERE 1 = 1 ${orderFilters.sql}
           GROUP BY od.is_project`,
          orderFilters.params,
        ),
      ]);

    const totalsRow = totalsRows?.[0] || {};
    const careRow = careRows?.[0] || {};
    const totals = {
      orders: this.num(totalsRow.orders),
      unclosedOrders: this.num(totalsRow.unclosedOrders),
      quotedOrders: this.num(totalsRow.quotedOrders),
      caredOrders: this.num(totalsRow.caredOrders),
      ordersCaredInPeriod: this.num(careRow.ordersCaredInPeriod),
      uncaredUnclosedOrders: this.num(totalsRow.uncaredUnclosedOrders),
      careActions: this.num(careRow.careActions),
      careBatches: this.num(careRow.careBatches),
      careCountLifetime: this.num(totalsRow.careCountLifetime),
      completedOrders: this.num(totalsRow.completedOrders),
      completedFromCare: this.num(totalsRow.completedFromCare),
      rejectedFromCare: this.num(totalsRow.rejectedFromCare),
      demandOrders: this.num(totalsRow.demandOrders),
      rejectedOrders: this.num(totalsRow.rejectedOrders),
    };

    const careCoverageDenominator =
      totals.caredOrders + totals.uncaredUnclosedOrders;
    const careCoverageRate = careCoverageDenominator
      ? totals.caredOrders / careCoverageDenominator
      : 0;
    const careConversionRate = totals.caredOrders
      ? totals.completedFromCare / totals.caredOrders
      : 0;

    const timeline = await this.buildTimeline(
      orderFrom,
      careFrom,
      orderFilters,
      careFilters,
      range,
      scope,
    );

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
      byStatus: (byStatusRows || []).map((row: any) => ({
        status: row.status,
        count: this.num(row.count),
        careCount: this.num(row.careCount),
      })),
      careTurnDistribution: this.buildTurnDistribution(turnRows || []),
      timeline,
      bySale: (bySaleRows || []).map((row: any) => ({
        userId: this.num(row.userId),
        fullName: row.fullName || null,
        orders: this.num(row.orders),
        unclosed: this.num(row.unclosed),
        cared: this.num(row.cared),
        careActions: this.num(row.careActions),
        completedFromCare: this.num(row.completedFromCare),
      })),
      byProject: (byProjectRows || []).map((row: any) => ({
        isProject: !!Number(row.isProject),
        orders: this.num(row.orders),
        cared: this.num(row.cared),
        careActions: this.num(row.careActions),
        completedFromCare: this.num(row.completedFromCare),
      })),
    };
  }

  private async buildTimeline(
    orderFrom: string,
    careFrom: string,
    orderFilters: { sql: string; params: any[] },
    careFilters: { sql: string; params: any[] },
    range: DateRange,
    scope: string,
  ) {
    const isMonthlyBucket =
      range.normalizedPeriod === 'quarter' ||
      range.normalizedPeriod === 'month' ||
      (range.normalizedPeriod === 'custom' &&
        range.to.getTime() - range.from.getTime() > 62 * 24 * 60 * 60 * 1000);
    const bucketExpr = isMonthlyBucket
      ? `DATE_FORMAT(od.created_at, '%Y-%m')`
      : `DATE_FORMAT(od.created_at, '%Y-%m-%d')`;
    const careBucketExpr = isMonthlyBucket
      ? `DATE_FORMAT(ci.cared_at, '%Y-%m')`
      : `DATE_FORMAT(ci.cared_at, '%Y-%m-%d')`;
    const completionBucketExpr = isMonthlyBucket
      ? `DATE_FORMAT(sh.changed_at, '%Y-%m')`
      : `DATE_FORMAT(sh.changed_at, '%Y-%m-%d')`;

    const [orders, care, completions] = await Promise.all([
      this.dataSource.query(
        `SELECT ${bucketExpr} AS bucket,
                COUNT(*) AS orders,
                SUM(CASE WHEN od.status IN ('quoted','cared') THEN 1 ELSE 0 END) AS unclosed,
                SUM(CASE WHEN od.care_count > 0 THEN 1 ELSE 0 END) AS cared
         ${orderFrom}
         WHERE 1 = 1 ${orderFilters.sql}
         GROUP BY bucket
         ORDER BY bucket ASC`,
        orderFilters.params,
      ),
      this.dataSource.query(
        `SELECT ${careBucketExpr} AS bucket,
                COUNT(*) AS careActions,
                COUNT(DISTINCT ci.order_detail_id) AS ordersCared,
                COUNT(DISTINCT ci.batch_id) AS careBatches
         ${careFrom}
         WHERE 1 = 1 ${careFilters.sql}
         GROUP BY bucket
         ORDER BY bucket ASC`,
        careFilters.params,
      ),
      this.dataSource.query(
        `SELECT ${completionBucketExpr} AS bucket,
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
           ${this.removeDateFilter(orderFilters.sql)}
         GROUP BY bucket
         ORDER BY bucket ASC`,
        [range.from, range.to, ...this.removeDateParams(orderFilters)],
      ),
    ]);

    const map = new Map<
      string,
      {
        bucket: string;
        orders: number;
        unclosed: number;
        cared: number;
        careActions: number;
        ordersCared: number;
        careBatches: number;
        completedFromCare: number;
      }
    >();

    const get = (bucket: string) => {
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
    };

    for (const row of orders || []) {
      const item = get(row.bucket);
      item.orders = this.num(row.orders);
      item.unclosed = this.num(row.unclosed);
      item.cared = this.num(row.cared);
    }
    for (const row of care || []) {
      const item = get(row.bucket);
      item.careActions = this.num(row.careActions);
      item.ordersCared = this.num(row.ordersCared);
      item.careBatches = this.num(row.careBatches);
    }
    for (const row of completions || []) {
      const item = get(row.bucket);
      item.completedFromCare = this.num(row.completedFromCare);
    }

    return Array.from(map.values()).sort((a, b) =>
      a.bucket.localeCompare(b.bucket),
    );
  }

  private buildTurnDistribution(rows: any[]) {
    const buckets = new Map<number, number>();
    for (const row of rows) {
      const careCount = Math.max(0, this.num(row.careCount));
      const bucket = careCount >= 5 ? 5 : careCount;
      buckets.set(bucket, (buckets.get(bucket) || 0) + this.num(row.orders));
    }

    const result: { careCount: number; orders: number; isPlus: boolean }[] = [];
    for (let i = 0; i <= 5; i += 1) {
      result.push({
        careCount: i,
        orders: buckets.get(i) || 0,
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

  private removeDateFilter(sql: string): string {
    return sql.replace(/\s+AND\s+[a-z_.]+\s+BETWEEN\s+\?\s+AND\s+\?/i, '');
  }

  private removeDateParams(filters: { sql: string; params: any[] }): any[] {
    const withoutDate = this.removeDateFilter(filters.sql);
    if (withoutDate === filters.sql) return filters.params;
    // Date params were pushed first in buildFilters (right after isProject)
    return filters.params.slice(2);
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

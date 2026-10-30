import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { OrderDetail } from './order-detail.entity';
import { RedisService } from '../common/cache/redis.service';
import {
  TransactionStatsParams,
  TransactionStatsResponse,
  TransactionDetailParams,
  TransactionDetailItem,
  SummaryStats,
  ChartDataPoint,
  CustomerStat,
  EmployeeStat,
  WorkingDaysInfo,
  DateRangePair,
} from './transaction-stats.interface';
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfQuarter,
  endOfQuarter,
} from 'date-fns';

/**
 * Chỉ số tồn đọng (GD + hết hạn) tính trên toàn bộ đơn còn sống, không phụ
 * thuộc khoảng ngày đang xem -> tách khỏi summary và cache riêng.
 */
interface BacklogStats {
  gdToday: number;
  gdYesterday: number;
  gd2DaysAgo: number;
  expiredToday: number;
  overdue: number;
}

const RESPONSE_CACHE_PREFIX = 'order-details:transactions';
const BACKLOG_CACHE_PREFIX = 'order-details:backlog';
const RESPONSE_CACHE_TTL_SECONDS = 60;
const BACKLOG_CACHE_TTL_SECONDS = 120;
/**
 * Backlog phải đếm ~570k đơn quá hạn nên luôn là full scan có kiểm soát.
 * Covering index (deleted_at, status, expiry_days) + ép thứ tự join giúp
 * 6.8s -> 2.4s; phần còn lại bù bằng cache.
 */
const BACKLOG_FORCE_HINT =
  'FORCE INDEX (idx_od_deleted_status_expiry) STRAIGHT_JOIN';

@Injectable()
export class TransactionStatsService {
  private readonly logger = new Logger(TransactionStatsService.name);

  constructor(
    @InjectRepository(OrderDetail)
    private orderDetailRepository: Repository<OrderDetail>,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Main method to get all transaction statistics in one optimized call
   */
  async getTransactionStats(
    params: TransactionStatsParams,
  ): Promise<TransactionStatsResponse> {
    const startTime = Date.now();

    try {
      // Calculate date ranges (current and previous for comparison)
      const ranges = this.calculateDateRanges(params);

      const cacheKey = this.buildResponseCacheKey(params, ranges);
      const cached =
        await this.redisService.get<TransactionStatsResponse>(cacheKey);
      if (cached) return cached;

      // Execute all queries in parallel for maximum performance
      const [periodData, backlog, chartData, customerData, employeeData] =
        await Promise.all([
          this.getPeriodSummary(ranges, params),
          this.getBacklogStats(params),
          this.getChartData(ranges.current, params),
          this.getCustomerStats(ranges.current, params),
          this.getEmployeeStats(ranges.current, params),
        ]);

      const summaryData: SummaryStats = {
        ...periodData,
        gdToday: backlog.gdToday,
        gdYesterday: backlog.gdYesterday,
        gd2DaysAgo: backlog.gd2DaysAgo,
      };

      const response: TransactionStatsResponse = {
        summary: summaryData,
        chartData: chartData,
        customerStats: customerData,
        employeeStats: employeeData,
        expiredStats: {
          expiredToday: backlog.expiredToday,
          overdue: backlog.overdue,
        },
        totalRecords:
          summaryData.completed +
          summaryData.quoted +
          summaryData.demand +
          summaryData.pending,
        dateRange: {
          from: ranges.current.from.toISOString().split('T')[0],
          to: ranges.current.to.toISOString().split('T')[0],
        },
        previousDateRange: {
          from: ranges.previous.from.toISOString().split('T')[0],
          to: ranges.previous.to.toISOString().split('T')[0],
        },
      };

      const duration = Date.now() - startTime;

      await this.redisService.set(
        cacheKey,
        response,
        RESPONSE_CACHE_TTL_SECONDS,
      );

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `❌ Transaction stats failed after ${duration}ms:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Build blacklist filter: exclude order_details whose metadata.customer_id appears
   * in order_blacklist.zalo_contact_id for the same user (ob.user_id = u.id).
   * Apply only for users with role 'manager' or 'user'.
   */
  private buildBlacklistFilter(user: any): string {
    if (!user) return '';

    const hasManagerOrUserRole = user.roles?.some(
      (r: any) =>
        r.name === 'manager' || r.name === 'user' || r.name.includes('manager'),
    );

    if (!hasManagerOrUserRole) return '';

    // Exclude order_details where metadata.customer_id matches order_blacklist.zalo_contact_id
    // and the blacklist entry belongs to the same user (ob.user_id = u.id)
    // Note: use the current user's id so we exclude contacts blacklisted by the viewer
    // If the user is a manager, also exclude blacklist entries created by users
    // in the manager's main departments (same logic used in buildPermissionFilter).
    // Determine department IDs from `user.departments` that have server_ip set.
    let deptFilter = '';
    if (user.departments && user.departments.length > 0) {
      const mainDepts = user.departments.filter(
        (d: any) => d.server_ip && d.server_ip.trim() !== '',
      );
      if (mainDepts.length > 0) {
        const deptIds = mainDepts.map((d: any) => d.id).join(',');
        // Subquery will find users who belong to those departments
        deptFilter = `OR ob.user_id IN (SELECT u2.id FROM users u2 JOIN users_departments ud2 ON u2.id = ud2.user_id WHERE ud2.department_id IN (${deptIds}))`;
      }
    }

    return `AND NOT EXISTS (
      SELECT 1 FROM order_blacklist ob
      WHERE ob.zalo_contact_id = od.meta_customer_id
        AND (ob.user_id = ${user.id} ${deptFilter ? deptFilter : ''})
    )`;
  }

  /**
   * Calculate current and previous date ranges based on period
   */
  private calculateDateRanges(params: TransactionStatsParams): DateRangePair {
    const { period, dateFrom, dateTo } = params;

    let current: { from: Date; to: Date };
    let previous: { from: Date; to: Date };

    // If user provides specific dateFrom/dateTo, use them regardless of period
    if (dateFrom && dateTo) {
      current = {
        from: startOfDay(new Date(dateFrom)),
        to: endOfDay(new Date(dateTo)),
      };

      // Calculate previous period based on the period type and current range duration
      if (period === 'day') {
        // For day period: previous day(s) with same duration
        const durationDays = Math.ceil(
          (current.to.getTime() - current.from.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        const previousEnd = new Date(current.from.getTime() - 1); // End just before current period
        const previousStart = new Date(
          previousEnd.getTime() - (durationDays - 1) * (1000 * 60 * 60 * 24),
        );
        previous = {
          from: startOfDay(previousStart),
          to: endOfDay(previousEnd),
        };
      } else {
        // For week/quarter/custom: use same duration
        const duration = current.to.getTime() - current.from.getTime();
        previous = {
          from: new Date(current.from.getTime() - duration),
          to: new Date(current.from.getTime() - 1), // End just before current period
        };
      }
    } else {
      // Use preset periods (day, week, quarter) when no specific dates provided
      current = this.getPresetRange(period);
      previous = this.getPreviousRange(period, current);
    }

    return { current, previous };
  }

  /**
   * Get preset date range based on period type
   */
  private getPresetRange(period: string): { from: Date; to: Date } {
    const now = new Date();
    const to = endOfDay(now);

    if (period === 'day' || period === 'week') {
      // Last 7 working days (excluding Sundays)
      return this.getLastNDaysExcludingSundays(7, now);
    }

    // quarter
    const q = Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), q * 3, 1);
    const last = new Date(now.getFullYear(), q * 3 + 3, 0);
    return { from: startOfDay(from), to: endOfDay(last) };
  }

  /**
   * Get previous period range for comparison
   */
  private getPreviousRange(
    period: string,
    current: { from: Date; to: Date },
  ): { from: Date; to: Date } {
    if (period === 'day' || period === 'week') {
      // Previous 7 working days before current range
      const prevEnd = new Date(current.from);
      prevEnd.setDate(prevEnd.getDate() - 1);
      return this.getLastNDaysExcludingSundays(7, prevEnd);
    }

    // quarter
    const now = current.from;
    const q = Math.floor(now.getMonth() / 3);
    const prevQ = q - 1;
    const year = prevQ < 0 ? now.getFullYear() - 1 : now.getFullYear();
    const quarterIndex = ((prevQ % 4) + 4) % 4;
    const pf = new Date(year, quarterIndex * 3, 1);
    const pt = new Date(year, quarterIndex * 3 + 3, 0);
    return { from: startOfDay(pf), to: endOfDay(pt) };
  }

  /**
   * Get last N working days excluding Sundays
   */
  private getLastNDaysExcludingSundays(
    n: number,
    end?: Date,
  ): { from: Date; to: Date } {
    const endDate = end ? new Date(end) : new Date();
    // If endDate is Sunday, move to Saturday
    if (endDate.getDay() === 0) {
      endDate.setDate(endDate.getDate() - 1);
    }

    const dates: Date[] = [];
    const cursor = new Date(endDate);

    while (dates.length < n) {
      if (cursor.getDay() !== 0) {
        // Not Sunday
        dates.push(new Date(cursor));
      }
      cursor.setDate(cursor.getDate() - 1);
    }

    const from = dates[dates.length - 1];
    const to = dates[0];
    return { from: startOfDay(from), to: endOfDay(to) };
  }

  /**
   * DEPRECATED: Get working days info (today, yesterday, 2 days ago)
   * Now using formula-based calculation instead of working days comparison
   */
  // private getWorkingDays(): WorkingDaysInfo {
  //   const today = new Date();
  //   const workingDays: Date[] = [];
  //   const cursor = new Date(today);
  //
  //   // Get last 3 working days (excluding Sundays and holidays)
  //   while (workingDays.length < 3) {
  //     if (cursor.getDay() !== 0) { // Not Sunday
  //       workingDays.push(startOfDay(new Date(cursor)));
  //     }
  //     cursor.setDate(cursor.getDate() - 1);
  //   }
  //
  //   return {
  //     day0: workingDays[0], // most recent
  //     day1: workingDays[1], // yesterday
  //     day2: workingDays[2], // 2 days ago
  //   };
  // }

  /**
   * Thống kê theo kỳ đang xem (current + previous).
   * Trước đây derived table không có điều kiện ngày nên mỗi request quét toàn
   * bộ bảng (~614k dòng): 8.1s. Giờ chỉ đọc khoảng current ∪ previous: ~0.25s.
   */
  private async getPeriodSummary(
    ranges: DateRangePair,
    params: TransactionStatsParams,
  ): Promise<Omit<SummaryStats, 'gdToday' | 'gdYesterday' | 'gd2DaysAgo'>> {
    const {
      blacklistFilter,
      employeeFilter,
      departmentFilter,
      permissionFilter,
    } = this.buildCommonFilters(params);

    const rangeFrom =
      ranges.current.from < ranges.previous.from
        ? ranges.current.from
        : ranges.previous.from;
    const rangeTo =
      ranges.current.to > ranges.previous.to
        ? ranges.current.to
        : ranges.previous.to;

    // Bảng dẫn xuất chỉ để gom nguồn dữ liệu, KHÔNG dùng DISTINCT: các điều kiện
    // lọc bên dưới đều là EXISTS và join orders là nhiều-về-một nên không có dòng
    // nào bị nhân.
    const query = `
      SELECT
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? THEN 1 ELSE 0 END) as current_total,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'completed' THEN 1 ELSE 0 END) as current_completed,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status IN ('quoted','cared') THEN 1 ELSE 0 END) as current_quoted,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'demand' THEN 1 ELSE 0 END) as current_demand,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'cared' THEN 1 ELSE 0 END) as current_cared,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'rejected' THEN 1 ELSE 0 END) as current_rejected,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'pending' THEN 1 ELSE 0 END) as current_pending,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'confirmed' THEN 1 ELSE 0 END) as current_confirmed,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'completed' THEN d.unit_price * d.quantity ELSE 0 END) as current_revenue,

        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? THEN 1 ELSE 0 END) as prev_total,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'completed' THEN 1 ELSE 0 END) as prev_completed,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status IN ('quoted','cared') THEN 1 ELSE 0 END) as prev_quoted,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'demand' THEN 1 ELSE 0 END) as prev_demand,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'cared' THEN 1 ELSE 0 END) as prev_cared,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'rejected' THEN 1 ELSE 0 END) as prev_rejected,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'pending' THEN 1 ELSE 0 END) as prev_pending,
        SUM(CASE WHEN d.created_at >= ? AND d.created_at <= ? AND d.status = 'completed' THEN d.unit_price * d.quantity ELSE 0 END) as prev_revenue
      FROM (
        SELECT od.created_at, od.status, od.unit_price, od.quantity
        FROM order_details od
        JOIN orders o ON od.order_id = o.id
        WHERE od.deleted_at IS NULL
          AND o.sale_by IS NOT NULL
          AND od.created_at >= ? AND od.created_at <= ?
          ${blacklistFilter}
          ${permissionFilter}
          ${employeeFilter}
          ${departmentFilter}
      ) d
    `;

    const queryParams = [
      ...Array.from({ length: 9 }, () => [
        ranges.current.from,
        ranges.current.to,
      ]).flat(),
      ...Array.from({ length: 8 }, () => [
        ranges.previous.from,
        ranges.previous.to,
      ]).flat(),
      rangeFrom,
      rangeTo,
    ];

    const result = await this.orderDetailRepository.query(query, queryParams);
    const row = result[0];

    const currentTotal = parseInt(row.current_total) || 0;
    const currentCompleted = parseInt(row.current_completed) || 0;
    const currentQuoted = parseInt(row.current_quoted) || 0;
    const currentRevenue = parseFloat(row.current_revenue) || 0;

    const prevTotal = parseInt(row.prev_total) || 0;
    const prevCompleted = parseInt(row.prev_completed) || 0;
    const prevQuoted = parseInt(row.prev_quoted) || 0;
    const prevRevenue = parseFloat(row.prev_revenue) || 0;

    return {
      chaoBan: currentCompleted + currentQuoted,
      completed: currentCompleted,
      quoted: currentQuoted,
      demand: parseInt(row.current_demand) || 0,
      cared: parseInt(row.current_cared) || 0,
      rejected: parseInt(row.current_rejected) || 0,
      pending: parseInt(row.current_pending) || 0,
      confirmed: parseInt(row.current_confirmed) || 0,
      totalRevenue: currentRevenue,
      avgOrderValue:
        currentCompleted > 0 ? currentRevenue / currentCompleted : 0,
      conversionRate:
        currentTotal > 0 ? (currentCompleted / currentTotal) * 100 : 0,

      prevChaoBan: prevCompleted + prevQuoted,
      prevCompleted,
      prevQuoted,
      prevDemand: parseInt(row.prev_demand) || 0,
      prevCared: parseInt(row.prev_cared) || 0,
      prevRejected: parseInt(row.prev_rejected) || 0,
      prevPending: parseInt(row.prev_pending) || 0,
      prevTotalRevenue: prevRevenue,
      prevAvgOrderValue: prevCompleted > 0 ? prevRevenue / prevCompleted : 0,
      prevConversionRate: prevTotal > 0 ? (prevCompleted / prevTotal) * 100 : 0,
    };
  }

  /**
   * Tồn đọng GD + hết hạn. Không phụ thuộc khoảng ngày nên tách riêng và cache
   * 120s; đây là query phải đếm toàn bộ đơn còn sống (~570k đơn quá hạn).
   */
  private async getBacklogStats(
    params: TransactionStatsParams,
  ): Promise<BacklogStats> {
    const {
      blacklistFilter,
      employeeFilter,
      departmentFilter,
      permissionFilter,
    } = this.buildCommonFilters(params);

    const cacheKey = `${BACKLOG_CACHE_PREFIX}:v1:${this.buildUserSignature(
      params,
    )}:${this.buildDayKey()}`;
    const cached = await this.redisService.get<BacklogStats>(cacheKey);
    if (cached) return cached;

    const hasFilters = !!(
      blacklistFilter ||
      permissionFilter ||
      employeeFilter ||
      departmentFilter
    );
    // Không có filter thì phải quét toàn bộ: ép đi theo covering index.
    // Có filter thì để optimizer tự chọn (thường drive từ orders theo sale_by).
    const fromClause = hasFilters
      ? 'FROM order_details od JOIN orders o ON o.id = od.order_id'
      : `FROM order_details od ${BACKLOG_FORCE_HINT} orders o ON o.id = od.order_id`;

    const query = `
      SELECT
        SUM(CASE WHEN od.status IN ('quoted','cared','demand') AND (od.expiry_days - TO_DAYS(CURDATE())) = 1 THEN 1 ELSE 0 END) as expired_today,
        SUM(CASE WHEN od.status IN ('quoted','cared','demand') AND (od.expiry_days - TO_DAYS(CURDATE())) < 1 THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN (od.expiry_days - TO_DAYS(CURDATE())) >= 4 THEN 1 ELSE 0 END) as gd_today,
        SUM(CASE WHEN (od.expiry_days - TO_DAYS(CURDATE())) = 3 THEN 1 ELSE 0 END) as gd_yesterday,
        SUM(CASE WHEN (od.expiry_days - TO_DAYS(CURDATE())) = 2 THEN 1 ELSE 0 END) as gd_2days
      ${fromClause}
      WHERE od.deleted_at IS NULL
        AND o.sale_by IS NOT NULL
        ${blacklistFilter}
        ${permissionFilter}
        ${employeeFilter}
        ${departmentFilter}
    `;

    let result: any[];
    try {
      result = await this.orderDetailRepository.query(query);
    } catch (error) {
      if (error?.errno !== 1176 && error?.code !== 'ER_KEY_DOES_NOT_EXIST') {
        throw error;
      }
      // DB chưa có index (môi trường mới trước lần synchronize đầu tiên).
      this.logger.warn(
        'idx_od_deleted_status_expiry chưa tồn tại, chạy lại query không hint',
      );
      result = await this.orderDetailRepository.query(
        query.replace(BACKLOG_FORCE_HINT, 'JOIN'),
      );
    }

    const row = result[0] || {};
    const stats: BacklogStats = {
      expiredToday: parseInt(row.expired_today) || 0,
      overdue: parseInt(row.overdue) || 0,
      gdToday: parseInt(row.gd_today) || 0,
      gdYesterday: parseInt(row.gd_yesterday) || 0,
      gd2DaysAgo: parseInt(row.gd_2days) || 0,
    };

    await this.redisService.set(cacheKey, stats, BACKLOG_CACHE_TTL_SECONDS);
    return stats;
  }

  /** Gom 4 filter dùng chung cho các query thống kê. */
  private buildCommonFilters(params: TransactionStatsParams) {
    return {
      permissionFilter: this.buildPermissionFilter(params.user),
      blacklistFilter: this.buildBlacklistFilter(params.user),
      employeeFilter: params.employees
        ? `AND EXISTS (SELECT 1 FROM orders o2 WHERE o2.id = od.order_id AND o2.sale_by IN (${params.employees}))`
        : '',
      departmentFilter: params.departments
        ? `AND EXISTS (
            SELECT 1 FROM orders o2
            JOIN users u2 ON o2.sale_by = u2.id
            JOIN users_departments ud2 ON u2.id = ud2.user_id
            WHERE o2.id = od.order_id AND ud2.department_id IN (${params.departments})
          )`
        : '',
    };
  }

  private buildResponseCacheKey(
    params: TransactionStatsParams,
    ranges: DateRangePair,
  ): string {
    return [
      RESPONSE_CACHE_PREFIX,
      'v1',
      this.buildUserSignature(params),
      params.period,
      params.dateFrom || '',
      params.dateTo || '',
      ranges.current.from.toISOString(),
      ranges.current.to.toISOString(),
    ].join(':');
  }

  /** Chữ ký user + bộ lọc: cùng input thì dùng chung cache. */
  private buildUserSignature(params: TransactionStatsParams): string {
    const user = params.user || {};
    const roleNames = (user.roles || []).map((r: any) =>
      (typeof r === 'string' ? r : r?.name || '').toLowerCase(),
    );
    // admin/view xem toàn bộ và 2 filter này đều rỗng -> kết quả giống hệt nhau,
    // dùng chung key để nhiều người mở dashboard chỉ tốn 1 lần tính.
    if (
      (roleNames.includes('admin') || roleNames.includes('view')) &&
      !params.employees &&
      !params.departments
    ) {
      return 'all';
    }
    return createHash('sha1')
      .update(
        JSON.stringify({
          id: user.id ?? null,
          roles: (user.roles || [])
            .map((r: any) => (typeof r === 'string' ? r : r?.name))
            .sort(),
          departments: (user.departments || []).map((d: any) => [
            d?.id ?? null,
            d?.server_ip ?? null,
          ]),
          employees: params.employees ?? null,
          departmentsParam: params.departments ?? null,
        }),
      )
      .digest('hex');
  }

  private buildDayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  }

  /**
   * Get chart data grouped by period
   */
  private async getChartData(
    range: { from: Date; to: Date },
    params: TransactionStatsParams,
  ): Promise<ChartDataPoint[]> {
    const permissionFilter = this.buildPermissionFilter(params.user);
    const blacklistFilter = this.buildBlacklistFilter(params.user);

    // Build EXISTS filters for employees and departments (avoid JOIN fan-out)
    const employeeFilter = params.employees
      ? `AND EXISTS (SELECT 1 FROM orders o2 WHERE o2.id = od.order_id AND o2.sale_by IN (${params.employees}))`
      : '';
    const departmentFilter = params.departments
      ? `AND EXISTS (
          SELECT 1 FROM orders o2 
          JOIN users u2 ON o2.sale_by = u2.id
          JOIN users_departments ud2 ON u2.id = ud2.user_id 
          WHERE o2.id = od.order_id AND ud2.department_id IN (${params.departments})
        )`
      : '';

    // Determine grouping based on period
    let dateFormat: string;
    let groupBy: string;

    if (params.period === 'day') {
      dateFormat = '%d/%m/%Y';
      groupBy = 'DATE(deduped.created_at)';
    } else if (params.period === 'week') {
      // Group by week (Monday as start of week)
      dateFormat = 'Tuần %d/%m-%d/%m';
      groupBy = 'YEARWEEK(deduped.created_at, 1)';
    } else if (params.period === 'custom') {
      // Custom period - show daily data
      dateFormat = '%d/%m/%Y';
      groupBy = 'DATE(deduped.created_at)';
    } else {
      // Quarter
      dateFormat = 'Q%q %Y';
      groupBy =
        'CONCAT(YEAR(deduped.created_at), "-", QUARTER(deduped.created_at))';
    }

    // Use subquery to deduplicate first, then aggregate without DISTINCT
    const query = `
      SELECT 
        ${groupBy} as period_key,
        DATE_FORMAT(MIN(deduped.created_at), '${dateFormat}') as period_name,
        UNIX_TIMESTAMP(DATE(MIN(deduped.created_at))) * 1000 as timestamp,
        SUM(CASE WHEN deduped.status = 'demand' THEN 1 ELSE 0 END) as demand,
        SUM(CASE WHEN deduped.status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN deduped.status IN ('quoted','cared') THEN 1 ELSE 0 END) as quoted,
        SUM(CASE WHEN deduped.status = 'cared' THEN 1 ELSE 0 END) as cared,
        SUM(CASE WHEN deduped.status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN deduped.status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN deduped.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
      FROM (
        SELECT od.created_at, od.status
        FROM order_details od
        JOIN orders o ON od.order_id = o.id
        WHERE od.deleted_at IS NULL
          AND o.sale_by IS NOT NULL
          ${blacklistFilter}
          AND od.created_at >= ?
          AND od.created_at <= ?
          AND DAYOFWEEK(od.created_at) != 1  -- Exclude Sundays
          ${permissionFilter}
          ${employeeFilter}
          ${departmentFilter}
      ) deduped
      GROUP BY ${groupBy}
      ORDER BY MIN(deduped.created_at)
      LIMIT 50
    `;

    const result = await this.orderDetailRepository.query(query, [
      range.from,
      range.to,
    ]);

    return result.map((row) => ({
      name: row.period_name,
      timestamp: parseInt(row.timestamp),
      demand: parseInt(row.demand) || 0,
      completed: parseInt(row.completed) || 0,
      quoted: parseInt(row.quoted) || 0,
      cared: parseInt(row.cared) || 0,
      rejected: parseInt(row.rejected) || 0,
      pending: parseInt(row.pending) || 0,
      confirmed: parseInt(row.confirmed) || 0,
    }));
  }

  /**
   * Get customer statistics
   */
  private async getCustomerStats(
    range: { from: Date; to: Date },
    params: TransactionStatsParams,
  ): Promise<CustomerStat[]> {
    const permissionFilter = this.buildPermissionFilter(params.user);
    const blacklistFilter = this.buildBlacklistFilter(params.user);

    // Build EXISTS filters for employees and departments (avoid JOIN fan-out)
    const employeeFilter = params.employees
      ? `AND EXISTS (SELECT 1 FROM orders o2 WHERE o2.id = od.order_id AND o2.sale_by IN (${params.employees}))`
      : '';
    const departmentFilter = params.departments
      ? `AND EXISTS (
          SELECT 1 FROM orders o2 
          JOIN users u2 ON o2.sale_by = u2.id
          JOIN users_departments ud2 ON u2.id = ud2.user_id 
          WHERE o2.id = od.order_id AND ud2.department_id IN (${params.departments})
        )`
      : '';

    // Use subquery to deduplicate first, then aggregate without DISTINCT
    const query = `
      SELECT 
        COALESCE(deduped.customer_name, '--') as customer_name,
        COUNT(*) as total,
        SUM(CASE WHEN deduped.status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN deduped.status IN ('quoted','cared') THEN 1 ELSE 0 END) as quoted,
        SUM(CASE WHEN deduped.status = 'cared' THEN 1 ELSE 0 END) as cared,
        SUM(CASE WHEN deduped.status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN deduped.status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN deduped.status = 'demand' THEN 1 ELSE 0 END) as demand,
        SUM(CASE WHEN deduped.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
      FROM (
        SELECT od.customer_name, od.status
        FROM order_details od
        JOIN orders o ON od.order_id = o.id
        WHERE od.deleted_at IS NULL
          AND o.sale_by IS NOT NULL
          ${blacklistFilter}
          AND od.created_at >= ?
          AND od.created_at <= ?
          AND DAYOFWEEK(od.created_at) != 1
          ${permissionFilter}
          ${employeeFilter}
          ${departmentFilter}
      ) deduped
      GROUP BY deduped.customer_name
      ORDER BY total DESC
    `;

    const result = await this.orderDetailRepository.query(query, [
      range.from,
      range.to,
    ]);

    return result.map((row) => ({
      name: row.customer_name,
      total: parseInt(row.total) || 0,
      completed: parseInt(row.completed) || 0,
      quoted: parseInt(row.quoted) || 0,
      cared: parseInt(row.cared) || 0,
      rejected: parseInt(row.rejected) || 0,
      pending: parseInt(row.pending) || 0,
      demand: parseInt(row.demand) || 0,
      confirmed: parseInt(row.confirmed) || 0,
    }));
  }

  /**
   * Get employee statistics
   */
  private async getEmployeeStats(
    range: { from: Date; to: Date },
    params: TransactionStatsParams,
  ): Promise<EmployeeStat[]> {
    const permissionFilter = this.buildPermissionFilter(params.user);
    const blacklistFilter = this.buildBlacklistFilter(params.user);

    // Build EXISTS filters for employees and departments (avoid JOIN fan-out)
    const employeeFilter = params.employees
      ? `AND EXISTS (SELECT 1 FROM orders o2 WHERE o2.id = od.order_id AND o2.sale_by IN (${params.employees}))`
      : '';
    const departmentFilter = params.departments
      ? `AND EXISTS (
          SELECT 1 FROM orders o2 
          JOIN users u2 ON o2.sale_by = u2.id
          JOIN users_departments ud2 ON u2.id = ud2.user_id 
          WHERE o2.id = od.order_id AND ud2.department_id IN (${params.departments})
        )`
      : '';

    // Use subquery to deduplicate first, then aggregate without DISTINCT
    const query = `
      SELECT 
        deduped.user_id as id,
        deduped.user_name as name,
        COUNT(*) as orders,
        COUNT(DISTINCT deduped.customer_name) as customers,
        SUM(CASE WHEN deduped.status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN deduped.status IN ('quoted','cared') THEN 1 ELSE 0 END) as quoted,
        CASE 
          WHEN SUM(CASE WHEN deduped.status IN ('completed', 'quoted', 'cared') THEN 1 ELSE 0 END) > 0
          THEN (SUM(CASE WHEN deduped.status = 'completed' THEN 1 ELSE 0 END) * 100.0) / 
               SUM(CASE WHEN deduped.status IN ('completed', 'quoted', 'cared') THEN 1 ELSE 0 END)
          ELSE 0
        END as conversion
      FROM (
        SELECT
          od.customer_name,
          od.status,
          u.id as user_id,
          COALESCE(u.full_name, u.username, CONCAT('NV ', u.id)) as user_name
        FROM order_details od
        JOIN orders o ON od.order_id = o.id
        JOIN users u ON o.sale_by = u.id
        WHERE od.deleted_at IS NULL
          ${blacklistFilter}
          AND od.created_at >= ?
          AND od.created_at <= ?
          AND DAYOFWEEK(od.created_at) != 1
          ${permissionFilter}
          ${employeeFilter}
          ${departmentFilter}
      ) deduped
      GROUP BY deduped.user_id, deduped.user_name
      ORDER BY orders DESC
      LIMIT 100
    `;

    const result = await this.orderDetailRepository.query(query, [
      range.from,
      range.to,
    ]);

    return result.map((row) => ({
      id: parseInt(row.id),
      name: row.name,
      orders: parseInt(row.orders) || 0,
      customers: parseInt(row.customers) || 0,
      completed: parseInt(row.completed) || 0,
      quoted: parseInt(row.quoted) || 0,
      conversion: parseFloat(row.conversion) || 0,
    }));
  }

  /**
   * Build permission filter based on user role
   */
  /**
   * Build permission filter based on user role
   */
  private buildPermissionFilter(user: any): string {
    if (!user) return '';

    // Admin và View - xem tất tần tật
    if (user.roles?.some((r: any) => r.name === 'admin' || r.name === 'view')) {
      return '';
    }

    // Manager/PM - xem toàn bộ của phòng ban chính (có server_ip khác rỗng và khác null)
    const hasManagerRole = user.roles?.some(
      (r: any) => r.name === 'manager' || r.name.includes('manager'),
    );
    if (hasManagerRole) {
      if (user.departments?.length > 0) {
        // Lọc chỉ phòng ban chính (có server_ip) - use EXISTS to avoid JOIN fan-out
        const mainDepts = user.departments.filter(
          (d: any) => d.server_ip && d.server_ip.trim() !== '',
        );
        if (mainDepts.length > 0) {
          const deptIds = mainDepts.map((d: any) => d.id).join(',');
          const filter = `AND EXISTS (
            SELECT 1 FROM users_departments ud2
            JOIN departments d2 ON ud2.department_id = d2.id
            WHERE ud2.user_id = o.sale_by AND d2.id IN (${deptIds})
          )`;
          return filter;
        } else {
          const filter = `AND o.sale_by = ${user.id}`;
          return filter;
        }
      } else {
        const filter = `AND o.sale_by = ${user.id}`;
        return filter;
      }
    }

    // User - chỉ xem dữ liệu của chính họ (nếu chỉ có role user và không có role manager)
    const hasOnlyUserRole =
      user.roles?.some((r: any) => r.name === 'user') && !hasManagerRole;
    if (hasOnlyUserRole) {
      const filter = `AND o.sale_by = ${user.id}`;
      return filter;
    }

    return '';
  }

  async getTransactionDetails(params: TransactionDetailParams): Promise<{
    items: TransactionDetailItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const {
      period,
      dateFrom,
      dateTo,
      timestamp,
      status,
      user,
      page = 1,
      limit = 20,
    } = params;

    // ✅ Validate timestamp
    if (!timestamp || isNaN(timestamp)) {
      this.logger.error(`❌ Invalid timestamp: ${timestamp}`);
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: 0,
      };
    }

    // ✅ Calculate the specific date range for the clicked bar
    const targetDate = new Date(timestamp);

    // ✅ Validate date
    if (isNaN(targetDate.getTime())) {
      this.logger.error(
        `❌ Invalid date from timestamp: ${timestamp} -> ${targetDate}`,
      );
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: 0,
      };
    }

    let periodStart: Date;
    let periodEnd: Date;

    if (period === 'day') {
      periodStart = startOfDay(targetDate);
      periodEnd = endOfDay(targetDate);
    } else if (period === 'week') {
      periodStart = startOfWeek(targetDate, { weekStartsOn: 1 }); // Monday start
      periodEnd = endOfWeek(targetDate, { weekStartsOn: 1 });
    } else if (period === 'quarter') {
      periodStart = startOfQuarter(targetDate);
      periodEnd = endOfQuarter(targetDate);
    } else {
      // custom - use the timestamp as the specific day
      periodStart = startOfDay(targetDate);
      periodEnd = endOfDay(targetDate);
    }

    // Build query with filters
    const blacklistFilter = this.buildBlacklistFilter(user);
    let query = `
      SELECT 
        od.id,
        od.order_id,
        od.customer_name,
        COALESCE(u.full_name, u.username, 'Unknown') as employee_name,
        COALESCE(p.product_name, od.raw_item, 'Unknown Product') as product_name,
        od.status,
        od.unit_price,
        od.quantity,
        (od.unit_price * od.quantity) as total_value,
        od.created_at,
        od.created_at as order_created_at
      FROM order_details od
      LEFT JOIN orders o ON od.order_id = o.id
      LEFT JOIN users u ON o.sale_by = u.id
      LEFT JOIN products p ON od.product_id = p.id
      WHERE od.deleted_at IS NULL
        ${blacklistFilter}
        AND od.created_at >= ? AND od.created_at <= ?
        AND DAYOFWEEK(od.created_at) != 1
    `;

    const queryParams: any[] = [periodStart, periodEnd];
    let paramIndex = 3;

    // Add status filter if specified
    if (status && status !== 'all') {
      query += ` AND od.status = ?`;
      queryParams.push(status);
      paramIndex++;
    }

    // Add permission filters using the same logic as main stats query
    const permissionFilter = this.buildPermissionFilter(user);
    if (permissionFilter) {
      query += ` ${permissionFilter}`;
    }

    // Order by creation date
    query += ` ORDER BY od.created_at DESC`;

    // Get total count first - optimize to avoid duplicates from JOINs
    const countQuery = `
      SELECT COUNT(DISTINCT od.id) as total
      FROM order_details od
      LEFT JOIN orders o ON od.order_id = o.id
      LEFT JOIN users u ON o.sale_by = u.id
      WHERE od.deleted_at IS NULL
        ${blacklistFilter}
        AND od.created_at >= ? AND od.created_at <= ?
        AND DAYOFWEEK(od.created_at) != 1
        ${status && status !== 'all' ? 'AND od.status = ?' : ''}
        ${permissionFilter}
    `;

    const countParams: any[] = [periodStart, periodEnd];
    if (status && status !== 'all') {
      countParams.push(status);
    }

    const countResult = await this.orderDetailRepository.query(
      countQuery,
      countParams,
    );
    const total = parseInt(countResult[0].total) || 0;

    // Add pagination
    const offset = (page - 1) * limit;
    query += ` LIMIT ? OFFSET ?`;
    queryParams.push(limit, offset);

    // Execute query
    const result = await this.orderDetailRepository.query(query, queryParams);

    return {
      items: result.map((row) => ({
        id: parseInt(row.id),
        order_id: parseInt(row.order_id),
        customer_name: row.customer_name,
        employee_name: row.employee_name,
        product_name: row.product_name,
        status: row.status,
        unit_price: parseFloat(row.unit_price) || 0,
        quantity: parseInt(row.quantity) || 1,
        total_value: parseFloat(row.total_value) || 0,
        created_at: row.created_at,
        order_created_at: row.order_created_at,
      })),
      total: total,
      page: page,
      pageSize: result.length,
    };
  }
}

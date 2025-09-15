import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderDetail } from './order-detail.entity';
import {
  TransactionStatsParams,
  TransactionStatsResponse,
  TransactionDetailParams,
  TransactionDetailItem,
  SummaryStats,
  ChartDataPoint,
  CustomerStat,
  EmployeeStat,
  ExpiredStats,
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

@Injectable()
export class TransactionStatsService {
  private readonly logger = new Logger(TransactionStatsService.name);

  constructor(
    @InjectRepository(OrderDetail)
    private orderDetailRepository: Repository<OrderDetail>,
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

      // Execute all queries in parallel for maximum performance
      const [summaryData, chartData, customerData, employeeData, expiredData] =
        await Promise.all([
          this.getSummaryStats(ranges, params),
          this.getChartData(ranges.current, params),
          this.getCustomerStats(ranges.current, params),
          this.getEmployeeStats(ranges.current, params),
          this.getExpiredStats(params),
        ]);

      const response: TransactionStatsResponse = {
        summary: summaryData,
        chartData: chartData,
        customerStats: customerData,
        employeeStats: employeeData,
        expiredStats: expiredData,
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

    const hasManagerOrUserRole = user.roles?.some((r: any) =>
      r.name === 'manager' || r.name === 'user' || r.name.includes('manager')
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
      WHERE ob.zalo_contact_id = JSON_UNQUOTE(JSON_EXTRACT(od.metadata, '$.customer_id'))
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

    if (period === 'custom' && dateFrom && dateTo) {
      // Custom date range
      current = {
        from: startOfDay(new Date(dateFrom)),
        to: endOfDay(new Date(dateTo)),
      };

      // Calculate previous period with same duration
      const duration = current.to.getTime() - current.from.getTime();
      previous = {
        from: new Date(current.from.getTime() - duration),
        to: new Date(current.from.getTime() - 1), // End just before current period
      };
    } else {
      // Preset periods (day, week, quarter)
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
   * Get summary statistics for current and previous periods
   */
  private async getSummaryStats(
    ranges: DateRangePair,
    params: TransactionStatsParams,
  ): Promise<SummaryStats> {
    // Build permission filter
    const permissionFilter = this.buildPermissionFilter(params.user);
    // Build blacklist filter (exclude blacklisted contacts for manager/user roles)
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

    // Use subquery to deduplicate order_details first, then aggregate without DISTINCT
    const query = `
      SELECT 
        -- Current period stats (no DISTINCT needed - already deduped)
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? THEN 1 ELSE 0 END) as current_total,
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? AND deduped.status = 'completed' THEN 1 ELSE 0 END) as current_completed,
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? AND deduped.status = 'quoted' THEN 1 ELSE 0 END) as current_quoted,
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? AND deduped.status = 'demand' THEN 1 ELSE 0 END) as current_demand,
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? AND deduped.status = 'pending' THEN 1 ELSE 0 END) as current_pending,
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? AND deduped.status = 'confirmed' THEN 1 ELSE 0 END) as current_confirmed,
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? AND deduped.status = 'completed' THEN deduped.unit_price * deduped.quantity ELSE 0 END) as current_revenue,
        
        -- Previous period stats (no DISTINCT needed - already deduped)
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? THEN 1 ELSE 0 END) as prev_total,
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? AND deduped.status = 'completed' THEN 1 ELSE 0 END) as prev_completed,
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? AND deduped.status = 'quoted' THEN 1 ELSE 0 END) as prev_quoted,
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? AND deduped.status = 'demand' THEN 1 ELSE 0 END) as prev_demand,
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? AND deduped.status = 'pending' THEN 1 ELSE 0 END) as prev_pending,
        SUM(CASE WHEN deduped.created_at >= ? AND deduped.created_at <= ? AND deduped.status = 'completed' THEN deduped.unit_price * deduped.quantity ELSE 0 END) as prev_revenue,
        
        -- New GD calculation based on formula: (created_at + extended - current_date)
        -- Logic: Số ngày còn lại trước khi hết hạn
        -- >= 4: Còn nhiều thời gian (GD bình thường)
        -- = 3: Còn 3 ngày (cần chú ý) 
        -- = 2: Còn 2 ngày (khá gấp)
        -- = 1: Còn 1 ngày (hết hạn hôm nay)
        -- <= 0: Đã quá hạn
        SUM(CASE WHEN DATEDIFF(DATE_ADD(DATE(deduped.created_at), INTERVAL COALESCE(deduped.extended, 4) DAY), CURDATE()) >= 4 THEN 1 ELSE 0 END) as gd_today,
        SUM(CASE WHEN DATEDIFF(DATE_ADD(DATE(deduped.created_at), INTERVAL COALESCE(deduped.extended, 4) DAY), CURDATE()) = 3 THEN 1 ELSE 0 END) as gd_yesterday,  
        SUM(CASE WHEN DATEDIFF(DATE_ADD(DATE(deduped.created_at), INTERVAL COALESCE(deduped.extended, 4) DAY), CURDATE()) = 2 THEN 1 ELSE 0 END) as gd_2days_ago
      FROM (
        SELECT DISTINCT od.id, od.created_at, od.status, od.unit_price, od.quantity, od.extended
        FROM order_details od
        JOIN orders o ON od.order_id = o.id
        JOIN users u ON o.sale_by = u.id
        WHERE od.deleted_at IS NULL
          ${blacklistFilter}
          ${permissionFilter}
          ${employeeFilter}
          ${departmentFilter}
      ) deduped
    `;

    const queryParams = [
      // Current period (7 times for different status conditions)
      ranges.current.from,
      ranges.current.to,
      ranges.current.from,
      ranges.current.to,
      ranges.current.from,
      ranges.current.to,
      ranges.current.from,
      ranges.current.to,
      ranges.current.from,
      ranges.current.to,
      ranges.current.from,
      ranges.current.to,
      ranges.current.from,
      ranges.current.to,

      // Previous period (6 times)
      ranges.previous.from,
      ranges.previous.to,
      ranges.previous.from,
      ranges.previous.to,
      ranges.previous.from,
      ranges.previous.to,
      ranges.previous.from,
      ranges.previous.to,
      ranges.previous.from,
      ranges.previous.to,
      ranges.previous.from,
      ranges.previous.to,

      // No more workingDays parameters needed - GD calculation now uses formula
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
      // Current period
      chaoBan: currentCompleted + currentQuoted,
      completed: currentCompleted,
      quoted: currentQuoted,
      demand: parseInt(row.current_demand) || 0,
      pending: parseInt(row.current_pending) || 0,
      confirmed: parseInt(row.current_confirmed) || 0,
      totalRevenue: currentRevenue,
      avgOrderValue:
        currentCompleted > 0 ? currentRevenue / currentCompleted : 0,
      conversionRate:
        currentTotal > 0 ? (currentCompleted / currentTotal) * 100 : 0,

      // Working days
      gdToday: parseInt(row.gd_today) || 0,
      gdYesterday: parseInt(row.gd_yesterday) || 0,
      gd2DaysAgo: parseInt(row.gd_2days_ago) || 0,

      // Previous period
      prevChaoBan: prevCompleted + prevQuoted,
      prevCompleted: prevCompleted,
      prevQuoted: prevQuoted,
      prevDemand: parseInt(row.prev_demand) || 0,
      prevPending: parseInt(row.prev_pending) || 0,
      prevTotalRevenue: prevRevenue,
      prevAvgOrderValue: prevCompleted > 0 ? prevRevenue / prevCompleted : 0,
      prevConversionRate: prevTotal > 0 ? (prevCompleted / prevTotal) * 100 : 0,
    };
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
      groupBy = 'CONCAT(YEAR(deduped.created_at), "-", QUARTER(deduped.created_at))';
    }

    // Use subquery to deduplicate first, then aggregate without DISTINCT
    const query = `
      SELECT 
        ${groupBy} as period_key,
        DATE_FORMAT(MIN(deduped.created_at), '${dateFormat}') as period_name,
        UNIX_TIMESTAMP(DATE(MIN(deduped.created_at))) * 1000 as timestamp,
        SUM(CASE WHEN deduped.status = 'demand' THEN 1 ELSE 0 END) as demand,
        SUM(CASE WHEN deduped.status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN deduped.status = 'quoted' THEN 1 ELSE 0 END) as quoted,
        SUM(CASE WHEN deduped.status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN deduped.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
      FROM (
        SELECT DISTINCT od.id, od.created_at, od.status
        FROM order_details od
        JOIN orders o ON od.order_id = o.id
        JOIN users u ON o.sale_by = u.id
        WHERE od.deleted_at IS NULL
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
        SUM(CASE WHEN deduped.status = 'quoted' THEN 1 ELSE 0 END) as quoted,
        SUM(CASE WHEN deduped.status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN deduped.status = 'demand' THEN 1 ELSE 0 END) as demand,
        SUM(CASE WHEN deduped.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
      FROM (
        SELECT DISTINCT od.id, od.customer_name, od.status
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
      GROUP BY deduped.customer_name
      ORDER BY total DESC
      LIMIT 1000
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
        SUM(CASE WHEN deduped.status = 'quoted' THEN 1 ELSE 0 END) as quoted,
        CASE 
          WHEN SUM(CASE WHEN deduped.status IN ('completed', 'quoted') THEN 1 ELSE 0 END) > 0
          THEN (SUM(CASE WHEN deduped.status = 'completed' THEN 1 ELSE 0 END) * 100.0) / 
               SUM(CASE WHEN deduped.status IN ('completed', 'quoted') THEN 1 ELSE 0 END)
          ELSE 0
        END as conversion
      FROM (
        SELECT DISTINCT 
          od.id, 
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
   * Get expired statistics with new formula: (created_at + extended - current_date)
   * = 1: Hết hạn hôm nay
   * < 1: Overdue (quá hạn)
   */
  private async getExpiredStats(
    params: TransactionStatsParams,
  ): Promise<ExpiredStats> {
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
        SUM(CASE 
          WHEN DATEDIFF(DATE_ADD(DATE(deduped.created_at), INTERVAL COALESCE(deduped.extended, 4) DAY), CURDATE()) = 1
          THEN 1 ELSE 0 
        END) as expired_today,
        SUM(CASE 
          WHEN DATEDIFF(DATE_ADD(DATE(deduped.created_at), INTERVAL COALESCE(deduped.extended, 4) DAY), CURDATE()) < 1
          THEN 1 ELSE 0 
        END) as overdue
      FROM (
        SELECT DISTINCT od.id, od.created_at, od.extended
        FROM order_details od
        JOIN orders o ON od.order_id = o.id
        JOIN users u ON o.sale_by = u.id
        WHERE od.deleted_at IS NULL
          ${blacklistFilter}
          AND od.status IN ('pending', 'demand', 'quoted')
          ${permissionFilter}
          ${employeeFilter}
          ${departmentFilter}
      ) deduped
    `;

    const result = await this.orderDetailRepository.query(query);
    const row = result[0];

    return {
      expiredToday: parseInt(row.expired_today) || 0,
      overdue: parseInt(row.overdue) || 0,
    };
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
            WHERE ud2.user_id = u.id AND d2.id IN (${deptIds})
          )`;
          return filter;
        } else {
          const filter = `AND u.id = ${user.id}`;
          return filter;
        }
      } else {
        const filter = `AND u.id = ${user.id}`;
        return filter;
      }
    }

    // User - chỉ xem dữ liệu của chính họ (nếu chỉ có role user và không có role manager)
    const hasOnlyUserRole =
      user.roles?.some((r: any) => r.name === 'user') && !hasManagerRole;
    if (hasOnlyUserRole) {
      const filter = `AND u.id = ${user.id}`;
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

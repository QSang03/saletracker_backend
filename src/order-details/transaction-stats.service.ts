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
  endOfQuarter
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
  async getTransactionStats(params: TransactionStatsParams): Promise<TransactionStatsResponse> {
    const startTime = Date.now();
    this.logger.log(`🚀 Starting transaction stats calculation for period: ${params.period}`);

    try {
      // Calculate date ranges (current and previous for comparison)
      const ranges = this.calculateDateRanges(params);
      
      // Get working days info for today/yesterday calculations
      const workingDays = this.getWorkingDays();

      // Execute all queries in parallel for maximum performance
      const [
        summaryData,
        chartData,
        customerData,
        employeeData,
        expiredData,
      ] = await Promise.all([
        this.getSummaryStats(ranges, workingDays, params),
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
        totalRecords: summaryData.completed + summaryData.quoted + summaryData.demand + summaryData.pending,
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
      this.logger.log(`✅ Transaction stats completed in ${duration}ms`);
      
      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Transaction stats failed after ${duration}ms:`, error);
      throw error;
    }
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
        to: endOfDay(new Date(dateTo))
      };
      
      // Calculate previous period with same duration
      const duration = current.to.getTime() - current.from.getTime();
      previous = {
        from: new Date(current.from.getTime() - duration),
        to: new Date(current.from.getTime() - 1) // End just before current period
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
  private getPreviousRange(period: string, current: { from: Date; to: Date }): { from: Date; to: Date } {
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
  private getLastNDaysExcludingSundays(n: number, end?: Date): { from: Date; to: Date } {
    const endDate = end ? new Date(end) : new Date();
    // If endDate is Sunday, move to Saturday
    if (endDate.getDay() === 0) {
      endDate.setDate(endDate.getDate() - 1);
    }
    
    const dates: Date[] = [];
    const cursor = new Date(endDate);
    
    while (dates.length < n) {
      if (cursor.getDay() !== 0) { // Not Sunday
        dates.push(new Date(cursor));
      }
      cursor.setDate(cursor.getDate() - 1);
    }
    
    const from = dates[dates.length - 1];
    const to = dates[0];
    return { from: startOfDay(from), to: endOfDay(to) };
  }

  /**
   * Get working days info (today, yesterday, 2 days ago)
   */
  private getWorkingDays(): WorkingDaysInfo {
    const today = new Date();
    const workingDays: Date[] = [];
    const cursor = new Date(today);
    
    // Get last 3 working days (excluding Sundays and holidays)
    while (workingDays.length < 3) {
      if (cursor.getDay() !== 0) { // Not Sunday
        workingDays.push(startOfDay(new Date(cursor)));
      }
      cursor.setDate(cursor.getDate() - 1);
    }
    
    return {
      day0: workingDays[0], // most recent
      day1: workingDays[1], // yesterday
      day2: workingDays[2], // 2 days ago
    };
  }

  /**
   * Get summary statistics for current and previous periods
   */
  private async getSummaryStats(
    ranges: DateRangePair, 
    workingDays: WorkingDaysInfo, 
    params: TransactionStatsParams
  ): Promise<SummaryStats> {
    // Build permission filter
    const permissionFilter = this.buildPermissionFilter(params.user);
    const employeeFilter = params.employees ? `AND u.id IN (${params.employees})` : '';
    const departmentFilter = params.departments ? `AND d.id IN (${params.departments})` : '';

    // Single optimized query for both current and previous period stats
    const query = `
      SELECT 
        -- Current period stats
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? THEN 1 ELSE 0 END) as current_total,
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? AND od.status = 'completed' THEN 1 ELSE 0 END) as current_completed,
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? AND od.status = 'quoted' THEN 1 ELSE 0 END) as current_quoted,
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? AND od.status = 'demand' THEN 1 ELSE 0 END) as current_demand,
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? AND od.status = 'pending' THEN 1 ELSE 0 END) as current_pending,
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? AND od.status = 'confirmed' THEN 1 ELSE 0 END) as current_confirmed,
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? AND od.status = 'completed' THEN od.unit_price * od.quantity ELSE 0 END) as current_revenue,
        
        -- Previous period stats
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? THEN 1 ELSE 0 END) as prev_total,
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? AND od.status = 'completed' THEN 1 ELSE 0 END) as prev_completed,
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? AND od.status = 'quoted' THEN 1 ELSE 0 END) as prev_quoted,
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? AND od.status = 'demand' THEN 1 ELSE 0 END) as prev_demand,
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? AND od.status = 'pending' THEN 1 ELSE 0 END) as prev_pending,
        SUM(CASE WHEN od.created_at >= ? AND od.created_at <= ? AND od.status = 'completed' THEN od.unit_price * od.quantity ELSE 0 END) as prev_revenue,
        
        -- Working days stats
        SUM(CASE WHEN DATE(od.created_at) = DATE(?) THEN 1 ELSE 0 END) as gd_today,
        SUM(CASE WHEN DATE(od.created_at) = DATE(?) THEN 1 ELSE 0 END) as gd_yesterday,
        SUM(CASE WHEN DATE(od.created_at) = DATE(?) THEN 1 ELSE 0 END) as gd_2days_ago
      FROM order_details od
      JOIN orders o ON od.order_id = o.id
      JOIN users u ON o.sale_by = u.id
      LEFT JOIN users_departments ud ON u.id = ud.user_id
      LEFT JOIN departments d ON ud.department_id = d.id
      WHERE od.deleted_at IS NULL
        AND od.hidden_at IS NULL
        ${permissionFilter}
        ${employeeFilter}
        ${departmentFilter}
    `;

    const queryParams = [
      // Current period (6 times for different status conditions)
      ranges.current.from, ranges.current.to,
      ranges.current.from, ranges.current.to,
      ranges.current.from, ranges.current.to,
      ranges.current.from, ranges.current.to,
      ranges.current.from, ranges.current.to,
      ranges.current.from, ranges.current.to,
      ranges.current.from, ranges.current.to,
      
      // Previous period (5 times)
      ranges.previous.from, ranges.previous.to,
      ranges.previous.from, ranges.previous.to,
      ranges.previous.from, ranges.previous.to,
      ranges.previous.from, ranges.previous.to,
      ranges.previous.from, ranges.previous.to,
      ranges.previous.from, ranges.previous.to,
      
      // Working days
      workingDays.day0,
      workingDays.day1,
      workingDays.day2,
    ];

    const result = await this.orderDetailRepository.query(query, queryParams);
    const row = result[0];

    const currentCompleted = parseInt(row.current_completed) || 0;
    const currentQuoted = parseInt(row.current_quoted) || 0;
    const currentRevenue = parseFloat(row.current_revenue) || 0;
    
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
      avgOrderValue: currentCompleted > 0 ? currentRevenue / currentCompleted : 0,
      conversionRate: currentCompleted + currentQuoted > 0 
        ? (currentCompleted / (currentCompleted + currentQuoted)) * 100 
        : 0,
      
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
      prevConversionRate: prevCompleted + prevQuoted > 0 
        ? (prevCompleted / (prevCompleted + prevQuoted)) * 100 
        : 0,
    };
  }

  /**
   * Get chart data grouped by period
   */
  private async getChartData(
    range: { from: Date; to: Date }, 
    params: TransactionStatsParams
  ): Promise<ChartDataPoint[]> {
    const permissionFilter = this.buildPermissionFilter(params.user);
    const employeeFilter = params.employees ? `AND u.id IN (${params.employees})` : '';
    const departmentFilter = params.departments ? `AND d.id IN (${params.departments})` : '';
    
    // Determine grouping based on period
    let dateFormat: string;
    let groupBy: string;
    
    if (params.period === 'day') {
      dateFormat = '%d/%m/%Y';
      groupBy = 'DATE(od.created_at)';
    } else if (params.period === 'week') {
      // Group by week (Monday as start of week)
      dateFormat = 'Tuần %d/%m-%d/%m';
      groupBy = 'YEARWEEK(od.created_at, 1)';
    } else if (params.period === 'custom') {
      // Custom period - show daily data  
      dateFormat = '%d/%m/%Y';
      groupBy = 'DATE(od.created_at)';
    } else {
      // Quarter
      dateFormat = 'Q%q %Y';
      groupBy = 'CONCAT(YEAR(od.created_at), "-", QUARTER(od.created_at))';
    }

    const query = `
      SELECT 
        ${groupBy} as period_key,
        DATE_FORMAT(MIN(od.created_at), '${dateFormat}') as period_name,
        UNIX_TIMESTAMP(DATE(MIN(od.created_at))) * 1000 as timestamp,
        SUM(CASE WHEN od.status = 'demand' THEN 1 ELSE 0 END) as demand,
        SUM(CASE WHEN od.status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN od.status = 'quoted' THEN 1 ELSE 0 END) as quoted,
        SUM(CASE WHEN od.status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN od.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
      FROM order_details od
      JOIN orders o ON od.order_id = o.id
      JOIN users u ON o.sale_by = u.id
      LEFT JOIN users_departments ud ON u.id = ud.user_id
      LEFT JOIN departments d ON ud.department_id = d.id
      WHERE od.deleted_at IS NULL
        AND od.hidden_at IS NULL
        AND od.created_at >= ?
        AND od.created_at <= ?
        AND DAYOFWEEK(od.created_at) != 1  -- Exclude Sundays
        ${permissionFilter}
        ${employeeFilter}
        ${departmentFilter}
      GROUP BY ${groupBy}
      ORDER BY MIN(od.created_at)
      LIMIT 50
    `;

    const result = await this.orderDetailRepository.query(query, [range.from, range.to]);
    
    return result.map(row => ({
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
    params: TransactionStatsParams
  ): Promise<CustomerStat[]> {
    const permissionFilter = this.buildPermissionFilter(params.user);
    const employeeFilter = params.employees ? `AND u.id IN (${params.employees})` : '';
    const departmentFilter = params.departments ? `AND d.id IN (${params.departments})` : '';

    const query = `
      SELECT 
        COALESCE(od.customer_name, '--') as customer_name,
        COUNT(*) as total,
        SUM(CASE WHEN od.status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN od.status = 'quoted' THEN 1 ELSE 0 END) as quoted,
        SUM(CASE WHEN od.status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN od.status = 'demand' THEN 1 ELSE 0 END) as demand,
        SUM(CASE WHEN od.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed
      FROM order_details od
      JOIN orders o ON od.order_id = o.id
      JOIN users u ON o.sale_by = u.id
      LEFT JOIN users_departments ud ON u.id = ud.user_id
      LEFT JOIN departments d ON ud.department_id = d.id
      WHERE od.deleted_at IS NULL
        AND od.hidden_at IS NULL
        AND od.created_at >= ?
        AND od.created_at <= ?
        AND DAYOFWEEK(od.created_at) != 1
        ${permissionFilter}
        ${employeeFilter}
        ${departmentFilter}
      GROUP BY od.customer_name
      ORDER BY total DESC
      LIMIT 1000
    `;

    const result = await this.orderDetailRepository.query(query, [range.from, range.to]);
    
    return result.map(row => ({
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
    params: TransactionStatsParams
  ): Promise<EmployeeStat[]> {
    const permissionFilter = this.buildPermissionFilter(params.user);
    const employeeFilter = params.employees ? `AND u.id IN (${params.employees})` : '';
    const departmentFilter = params.departments ? `AND d.id IN (${params.departments})` : '';

    const query = `
      SELECT 
        u.id,
        COALESCE(u.full_name, u.username, CONCAT('NV ', u.id)) as name,
        COUNT(*) as orders,
        COUNT(DISTINCT CASE WHEN od.customer_name IS NOT NULL THEN od.customer_name END) as customers,
        SUM(CASE WHEN od.status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN od.status = 'quoted' THEN 1 ELSE 0 END) as quoted,
        CASE 
          WHEN SUM(CASE WHEN od.status IN ('completed', 'quoted') THEN 1 ELSE 0 END) > 0
          THEN (SUM(CASE WHEN od.status = 'completed' THEN 1 ELSE 0 END) * 100.0) / 
               SUM(CASE WHEN od.status IN ('completed', 'quoted') THEN 1 ELSE 0 END)
          ELSE 0
        END as conversion
      FROM order_details od
      JOIN orders o ON od.order_id = o.id
      JOIN users u ON o.sale_by = u.id
      LEFT JOIN users_departments ud ON u.id = ud.user_id
      LEFT JOIN departments d ON ud.department_id = d.id
      WHERE od.deleted_at IS NULL
        AND od.hidden_at IS NULL
        AND od.created_at >= ?
        AND od.created_at <= ?
        AND DAYOFWEEK(od.created_at) != 1
        ${permissionFilter}
        ${employeeFilter}
        ${departmentFilter}
      GROUP BY u.id, u.full_name, u.username
      ORDER BY orders DESC
      LIMIT 100
    `;

    const result = await this.orderDetailRepository.query(query, [range.from, range.to]);
    
    return result.map(row => ({
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
   * Get expired statistics
   */
  private async getExpiredStats(params: TransactionStatsParams): Promise<ExpiredStats> {
    const permissionFilter = this.buildPermissionFilter(params.user);
    const employeeFilter = params.employees ? `AND u.id IN (${params.employees})` : '';
    const departmentFilter = params.departments ? `AND d.id IN (${params.departments})` : '';
    
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const query = `
      SELECT 
        SUM(CASE 
          WHEN DATEDIFF(CURDATE(), DATE_ADD(DATE(od.created_at), INTERVAL od.extended DAY)) = 0 
          THEN 1 ELSE 0 
        END) as expired_today,
        SUM(CASE 
          WHEN DATEDIFF(CURDATE(), DATE_ADD(DATE(od.created_at), INTERVAL od.extended DAY)) > 0 
          THEN 1 ELSE 0 
        END) as overdue
      FROM order_details od
      JOIN orders o ON od.order_id = o.id
      JOIN users u ON o.sale_by = u.id
      LEFT JOIN users_departments ud ON u.id = ud.user_id
      LEFT JOIN departments d ON ud.department_id = d.id
      WHERE od.deleted_at IS NULL
        AND od.hidden_at IS NULL
        AND od.status IN ('pending', 'demand', 'quoted')
        ${permissionFilter}
        ${employeeFilter}
        ${departmentFilter}
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
    const hasManagerRole = user.roles?.some((r: any) => 
      r.name === 'manager' || r.name.includes('manager')
    );
    if (hasManagerRole) {
      if (user.departments?.length > 0) {
        // Lọc chỉ phòng ban chính (có server_ip)
        const mainDepts = user.departments.filter((d: any) => d.server_ip && d.server_ip.trim() !== '');
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
    const hasOnlyUserRole = user.roles?.some((r: any) => r.name === 'user') && !hasManagerRole;
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
    const { period, dateFrom, dateTo, timestamp, status, user, page = 1, limit = 20 } = params;
    
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
      this.logger.error(`❌ Invalid date from timestamp: ${timestamp} -> ${targetDate}`);
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
        o.created_at as order_created_at
      FROM order_details od
      LEFT JOIN orders o ON od.order_id = o.id
      LEFT JOIN users u ON o.sale_by = u.id
      LEFT JOIN products p ON od.product_id = p.id
      WHERE od.created_at >= ? AND od.created_at <= ?
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
    
    // Get total count first
    const countQuery = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = await this.orderDetailRepository.query(countQuery, queryParams);
    const total = parseInt(countResult[0].total) || 0;
    
    // Add pagination
    const offset = (page - 1) * limit;
    query += ` LIMIT ? OFFSET ?`;
    queryParams.push(limit, offset);
    
    // Execute query
    const result = await this.orderDetailRepository.query(query, queryParams);

    return {
      items: result.map(row => ({
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
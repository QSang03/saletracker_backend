import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DebtStatisticService } from './debt_statistic.service';

@Controller('debt-statistics')
export class DebtStatisticController {
  constructor(
    private readonly debtStatisticService: DebtStatisticService,
  ) {}

  // Test endpoint without authentication
  @Get('test')
  async testData() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      const overview = await this.debtStatisticService.getOverviewStatistics(
        weekAgo,
        today,
      );
      return {
        success: true,
        dateRange: { from: weekAgo, to: today },
        overview,
        message: 'Test endpoint working',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stack: error.stack,
      };
    }
  }

  @Get('overview')
  @UseGuards(JwtAuthGuard)
  async getOverviewStatistics(
    @Query('from') fromDate: string,
    @Query('to') toDate: string,
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
  ) {
    return this.debtStatisticService.getOverviewStatistics(fromDate, toDate, { employeeCode, customerCode });
  }

  @Get('trend')
  @UseGuards(JwtAuthGuard)
  async getTrendStatistics(
    @Query('from') fromDate: string,
    @Query('to') toDate: string,
    @Query('groupBy') groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    return this.debtStatisticService.getTrendStatistics(
      fromDate,
      toDate,
      groupBy,
    );
  }

  @Get('aging')
  @UseGuards(JwtAuthGuard)
  async getAgingAnalysis(
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
    @Query('singleDate') singleDate?: string,
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
  ) {
    return this.debtStatisticService.getAgingAnalysisAsOf({
      singleDate,
      from: fromDate,
      to: toDate,
      employeeCode,
      customerCode,
    });
  }

  // Daily aging buckets per day (4 buckets) similar to overview trends
  @Get('aging-daily')
  @UseGuards(JwtAuthGuard)
  async getAgingDaily(
    @Query('from') fromDate: string,
    @Query('to') toDate: string,
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
  ) {
    return this.debtStatisticService.getAgingDaily(fromDate, toDate, { employeeCode, customerCode });
  }

  // New: Pay-later delay buckets (hybrid: history from debt_statistics, today from debts)
  @Get('pay-later-delay')
  @UseGuards(JwtAuthGuard)
  async getPayLaterDelay(
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
    @Query('singleDate') singleDate?: string,
    @Query('buckets') buckets: string = '7,14,30',
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
  ) {
    const bucketNumbers = buckets
      .split(',')
      .map((b) => parseInt(b.trim(), 10))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    if (!fromDate || !toDate) {
      const today = new Date().toISOString().split('T')[0];
      fromDate = fromDate || today;
      toDate = toDate || today;
    }
    try {
      return await this.debtStatisticService.getPayLaterDelay(
        fromDate,
        toDate,
        bucketNumbers,
        { employeeCode, customerCode },
      );
    } catch (error) {
      // Log and return structured error for easier frontend debugging
      // eslint-disable-next-line no-console
      console.error('[getPayLaterDelay] Error:', error?.message || error, error?.stack || 'no-stack');
      return { success: false, error: error?.message || 'Internal Server Error' };
    }
  }

  // Daily pay-later delay buckets per day
  @Get('pay-later-delay-daily')
  @UseGuards(JwtAuthGuard)
  async getPayLaterDelayDaily(
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
    @Query('buckets') buckets: string = '7,14,30',
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
  ) {
    const bucketNumbers = buckets
      .split(',')
      .map((b) => parseInt(b.trim(), 10))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    if (!fromDate || !toDate) {
      const today = new Date().toISOString().split('T')[0];
      fromDate = fromDate || today;
      toDate = toDate || today;
    }
    try {
      return await this.debtStatisticService.getPayLaterDelayDaily(fromDate, toDate, bucketNumbers, { employeeCode, customerCode });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[getPayLaterDelayDaily] Error:', error?.message || error, error?.stack || 'no-stack');
      return { success: false, error: error?.message || 'Internal Server Error' };
    }
  }

  // New: Contact responses aggregation (hybrid: history from debt_histories, today from debt_logs)
  @Get('contact-responses')
  @UseGuards(JwtAuthGuard)
  async getContactResponses(
    @Query('from') fromDate: string,
    @Query('to') toDate: string,
    @Query('by') by: 'customer' | 'invoice' = 'customer',
    @Query('mode') mode: 'events' | 'distribution' = 'events',
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
  ) {
    return this.debtStatisticService.getContactResponses(
      fromDate,
      toDate,
      by,
      { employeeCode, customerCode, mode },
    );
  }

  // Daily customer responses by remind_status per day
  @Get('contact-responses-daily')
  @UseGuards(JwtAuthGuard)
  async getContactResponsesDaily(
    @Query('from') fromDate: string,
    @Query('to') toDate: string,
    @Query('by') by: 'customer' | 'invoice' = 'customer',
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
  ) {
    return this.debtStatisticService.getContactResponsesDaily(fromDate, toDate, by, { employeeCode, customerCode });
  }

  @Get('trends')
  @UseGuards(JwtAuthGuard)
  async getTrends(
    @Query('from') fromDate: string,
    @Query('to') toDate: string,
    @Query('groupBy') groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    return this.debtStatisticService.getTrends(fromDate, toDate, groupBy);
  }

  @Get('employee-performance')
  @UseGuards(JwtAuthGuard)
  async getEmployeePerformance(
    @Query('from') fromDate: string,
    @Query('to') toDate: string,
  ) {
    return this.debtStatisticService.getEmployeePerformance(fromDate, toDate);
  }

  @Get('detailed')
  @UseGuards(JwtAuthGuard)
  async getDetailedDebts(
    @Query('date') date: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
    @Query('contactStatus') contactStatus?: string,
    @Query('mode') mode?: 'overdue' | 'payLater' | 'status',
    @Query('minDays') minDays?: string,
    @Query('maxDays') maxDays?: string,
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('all') all?: string,
  ) {
    // Allow either single date or from/to range
    // Không tự động fallback về ngày hôm nay - để frontend truyền đúng ngày từ chart
    if (!date && (!from || !to)) {
      throw new Error('Either date or from/to parameters are required');
    }
    
    let parsedLimit = parseInt(limit, 10);
    
    // Hỗ trợ lấy tất cả dữ liệu cho frontend lazy loading
    if (all === 'true' || parsedLimit >= 100000) {
      parsedLimit = 100000; // Giới hạn tối đa để tránh memory issues
    }
    
    const filters: any = {
      date,
      from,
      to,
      status,
      contactStatus,
      mode,
      minDays: minDays ? parseInt(minDays, 10) : undefined,
      maxDays: maxDays ? parseInt(maxDays, 10) : undefined,
      employeeCode,
      customerCode,
      page: parseInt(page, 10),
      limit: parsedLimit,
    };

    // Không force today nữa - để frontend truyền đúng ngày từ chart
    // Logic cũ gây lỗi khi click vào cột paid của ngày quá khứ
    // Đã xóa hoàn toàn logic fallback về ngày hôm nay
    
    const result = await this.debtStatisticService.getDetailedDebts(filters);
    
    return result;
  }

  // New: Contact details (distinct customers by response status)
  @Get('contact-details')
  @UseGuards(JwtAuthGuard)
  async getContactDetails(
    @Query('responseStatus') responseStatus: string,
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('mode') mode: 'events' | 'distribution' = 'events',
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    if ((!date && (!from || !to)) || !responseStatus) {
      throw new Error('Either date or from/to and responseStatus are required');
    }
    return this.debtStatisticService.getContactDetails({
      date,
      from,
      to,
      responseStatus,
      mode,
      employeeCode,
      customerCode,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }
}

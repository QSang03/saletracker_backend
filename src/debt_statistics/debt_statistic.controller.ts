import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DebtStatisticService } from './debt_statistic.service';
import { CronjobService } from '../cronjobs/cronjob.service';

@Controller('debt-statistics')
export class DebtStatisticController {
  constructor(
    private readonly debtStatisticService: DebtStatisticService,
    private readonly cronjobService: CronjobService,
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
  ) {
    return this.debtStatisticService.getOverviewStatistics(fromDate, toDate);
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
    @Query('from') fromDate: string,
    @Query('to') toDate: string,
  ) {
    return this.debtStatisticService.getAgingAnalysis(fromDate, toDate);
  }

  // New: Pay-later delay buckets (hybrid: history from debt_statistics, today from debts)
  @Get('pay-later-delay')
  @UseGuards(JwtAuthGuard)
  async getPayLaterDelay(
    @Query('from') fromDate: string,
    @Query('to') toDate: string,
    @Query('buckets') buckets: string = '7,14,30',
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
  ) {
    const bucketNumbers = buckets
      .split(',')
      .map((b) => parseInt(b.trim(), 10))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    return this.debtStatisticService.getPayLaterDelay(
      fromDate,
      toDate,
      bucketNumbers,
      { employeeCode, customerCode },
    );
  }

  // New: Contact responses aggregation (hybrid: history from debt_histories, today from debt_logs)
  @Get('contact-responses')
  @UseGuards(JwtAuthGuard)
  async getContactResponses(
    @Query('from') fromDate: string,
    @Query('to') toDate: string,
    @Query('by') by: 'customer' | 'invoice' = 'customer',
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
  ) {
    return this.debtStatisticService.getContactResponses(
      fromDate,
      toDate,
      by,
      { employeeCode, customerCode },
    );
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

  @Post('capture')
  @UseGuards(JwtAuthGuard)
  async captureDebtStatistics(@Query('date') date?: string) {
    return this.cronjobService.captureDebtStatisticsManual(date);
  }

  @Get('detailed')
  @UseGuards(JwtAuthGuard)
  async getDetailedDebts(
    @Query('date') date: string,
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
    if (!date) {
      throw new Error('Date parameter is required');
    }
    
    let parsedLimit = parseInt(limit, 10);
    
    // Hỗ trợ lấy tất cả dữ liệu cho frontend lazy loading
    if (all === 'true' || parsedLimit >= 100000) {
      parsedLimit = 100000; // Giới hạn tối đa để tránh memory issues
    }
    
    const filters = {
      date,
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
    
    const result = await this.debtStatisticService.getDetailedDebts(filters);
    return result;
  }

  // New: Contact details (distinct customers by response status)
  @Get('contact-details')
  @UseGuards(JwtAuthGuard)
  async getContactDetails(
    @Query('date') date: string,
    @Query('responseStatus') responseStatus: string,
    @Query('employeeCode') employeeCode?: string,
    @Query('customerCode') customerCode?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    if (!date || !responseStatus) {
      throw new Error('date and responseStatus are required');
    }
    return this.debtStatisticService.getContactDetails({
      date,
      responseStatus,
      employeeCode,
      customerCode,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }
}

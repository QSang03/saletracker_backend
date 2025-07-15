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
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    const filters = {
      date,
      status,
      contactStatus,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    };
    return this.debtStatisticService.getDetailedDebts(filters);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DebtStatistic } from './debt_statistic.entity';
import { Debt } from '../debts/debt.entity';

@Injectable()
export class DebtStatisticService {
  private readonly logger = new Logger(DebtStatisticService.name);

  constructor(
    @InjectRepository(DebtStatistic)
    private readonly debtStatisticRepository: Repository<DebtStatistic>,
    @InjectRepository(Debt)
    private readonly debtRepository: Repository<Debt>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_11PM)
  async captureDailyStatistics() {
    const date = new Date().toISOString().split('T')[0];

    try {
      // Query để capture debts chưa có trong debt_statistics
      // Sử dụng DATE(created_at) làm statistic_date thay vì ngày chạy cronjob
      const query = `
        INSERT INTO debt_statistics (
          statistic_date, customer_raw_code, invoice_code, bill_code,
          total_amount, remaining, issue_date, due_date, pay_later,
          status, sale_id, sale_name_raw, employee_code_raw,
          debt_config_id, customer_code, customer_name, note,
          is_notified, original_created_at, original_updated_at, original_debt_id
        )
        SELECT 
          DATE(d.created_at) as statistic_date,
          d.customer_raw_code, d.invoice_code, d.bill_code,
          d.total_amount, d.remaining, d.issue_date, d.due_date, d.pay_later,
          d.status, d.sale_id, d.sale_name_raw, d.employee_code_raw,
          d.debt_config_id, dc.customer_code, dc.customer_name, d.note,
          d.is_notified, d.created_at, d.updated_at, d.id
        FROM debts d
        LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
        WHERE d.deleted_at IS NULL 
        AND d.id NOT IN (
          SELECT original_debt_id FROM debt_statistics WHERE original_debt_id IS NOT NULL
        )
      `;

      const result = await this.debtStatisticRepository.query(query);
      
    } catch (error) {
      this.logger.error(`Failed to capture debt statistics for ${date}:`, error);
      throw error;
    }
  }

  async getOverviewStatistics(fromDate: string, toDate: string) {
    const today = new Date().toISOString().split('T')[0];
    
    const results = {
      total: 0,
      paid: 0,
      payLater: 0,
      noInfo: 0,
      totalAmount: 0,
      paidAmount: 0,
      remainingAmount: 0,
      collectionRate: 0,
    };

    // Xử lý các ngày trong quá khứ từ debt_statistics
    if (fromDate < today) {
      const endDateForHistory = toDate < today ? toDate : 
        new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const historyQuery = `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
          SUM(CASE WHEN status = 'pay_later' THEN 1 ELSE 0 END) as payLater,
          SUM(CASE WHEN status = 'no_information_available' THEN 1 ELSE 0 END) as noInfo,
          SUM(total_amount) as totalAmount,
          SUM(total_amount - remaining) as paidAmount,
          SUM(remaining) as remainingAmount
        FROM debt_statistics
        WHERE statistic_date >= ? AND statistic_date <= ?
      `;

      const historyStats = await this.debtStatisticRepository.query(historyQuery, [fromDate, endDateForHistory]);
      
      if (historyStats[0]) {
        const stats = historyStats[0];
        results.total += Number(stats.total) || 0;
        results.paid += Number(stats.paid) || 0;
        results.payLater += Number(stats.payLater) || 0;
        results.noInfo += Number(stats.noInfo) || 0;
        results.totalAmount += Number(stats.totalAmount) || 0;
        results.paidAmount += Number(stats.paidAmount) || 0;
        results.remainingAmount += Number(stats.remainingAmount) || 0;
      }
    }

    // Xử lý ngày hôm nay từ debts
    if (toDate >= today) {
      const todayQuery = `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN d.status = 'paid' THEN 1 ELSE 0 END) as paid,
          SUM(CASE WHEN d.status = 'pay_later' THEN 1 ELSE 0 END) as payLater,
          SUM(CASE WHEN d.status = 'no_information_available' THEN 1 ELSE 0 END) as noInfo,
          SUM(d.total_amount) as totalAmount,
          SUM(d.total_amount - d.remaining) as paidAmount,
          SUM(d.remaining) as remainingAmount
        FROM debts d
        WHERE d.deleted_at IS NULL
      `;

      const todayStats = await this.debtRepository.query(todayQuery);
      
      if (todayStats[0]) {
        const stats = todayStats[0];
        results.total += Number(stats.total) || 0;
        results.paid += Number(stats.paid) || 0;
        results.payLater += Number(stats.payLater) || 0;
        results.noInfo += Number(stats.noInfo) || 0;
        results.totalAmount += Number(stats.totalAmount) || 0;
        results.paidAmount += Number(stats.paidAmount) || 0;
        results.remainingAmount += Number(stats.remainingAmount) || 0;
      }
    }

    // Tính collection rate
    if (results.totalAmount > 0) {
      results.collectionRate = (results.paidAmount / results.totalAmount) * 100;
    }

    return results;
  }

  async getTrendStatistics(fromDate: string, toDate: string, groupBy: 'day' | 'week' | 'month' = 'day') {
    const today = new Date().toISOString().split('T')[0];
    const results: Array<{
      date: string;
      name: string;
      total: number;
      paid: number;
      pay_later: number;
      no_info: number;
      totalAmount: number;
      collectionRate: number;
    }> = [];

    // Generate date range
    const dates = this.generateDateRange(fromDate, toDate);

    for (const date of dates) {
      if (date < today) {
        // Lấy từ debt_statistics
        const query = `
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
            SUM(CASE WHEN status = 'pay_later' THEN 1 ELSE 0 END) as pay_later,
            SUM(CASE WHEN status = 'no_information_available' THEN 1 ELSE 0 END) as no_info,
            SUM(total_amount) as totalAmount,
            AVG(CASE WHEN total_amount > 0 THEN ((total_amount - remaining) / total_amount) * 100 ELSE 0 END) as collectionRate
          FROM debt_statistics
          WHERE statistic_date = ?
        `;

        const stats = await this.debtStatisticRepository.query(query, [date]);
        const data = stats[0] || {};

        results.push({
          date,
          name: date,
          total: Number(data.total) || 0,
          paid: Number(data.paid) || 0,
          pay_later: Number(data.pay_later) || 0,
          no_info: Number(data.no_info) || 0,
          totalAmount: Number(data.totalAmount) || 0,
          collectionRate: Number(data.collectionRate) || 0,
        });
      } else if (date === today) {
        // Lấy từ debts
        const query = `
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
            SUM(CASE WHEN status = 'pay_later' THEN 1 ELSE 0 END) as pay_later,
            SUM(CASE WHEN status = 'no_information_available' THEN 1 ELSE 0 END) as no_info,
            SUM(total_amount) as totalAmount,
            AVG(CASE WHEN total_amount > 0 THEN ((total_amount - remaining) / total_amount) * 100 ELSE 0 END) as collectionRate
          FROM debts
          WHERE deleted_at IS NULL
        `;

        const stats = await this.debtRepository.query(query);
        const data = stats[0] || {};

        results.push({
          date,
          name: date,
          total: Number(data.total) || 0,
          paid: Number(data.paid) || 0,
          pay_later: Number(data.pay_later) || 0,
          no_info: Number(data.no_info) || 0,
          totalAmount: Number(data.totalAmount) || 0,
          collectionRate: Number(data.collectionRate) || 0,
        });
      }
    }

    return results;
  }

  async getDetailedDebts(filters: any) {
    const today = new Date().toISOString().split('T')[0];
    const { date, status, page = 1, limit = 10 } = filters;
    const offset = (page - 1) * limit;

    if (date < today) {
      // Query từ debt_statistics
      let query = `
        SELECT * FROM debt_statistics 
        WHERE statistic_date = ?
      `;
      const params: any[] = [date];

      if (status) {
        query += ` AND status = ?`;
        params.push(status);
      }

      query += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const data = await this.debtStatisticRepository.query(query, params);

      // Count total
      let countQuery = `
        SELECT COUNT(*) as total FROM debt_statistics 
        WHERE statistic_date = ?
      `;
      const countParams: any[] = [date];

      if (status) {
        countQuery += ` AND status = ?`;
        countParams.push(status);
      }

      const totalResult = await this.debtStatisticRepository.query(countQuery, countParams);
      const total = totalResult[0]?.total || 0;

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } else {
      // Query từ debts
      let query = `
        SELECT d.*, dc.customer_code, dc.customer_name, u.fullName as sale_name
        FROM debts d
        LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
        LEFT JOIN users u ON d.sale_id = u.id
        WHERE d.deleted_at IS NULL
      `;
      const params: any[] = [];

      if (status) {
        query += ` AND d.status = ?`;
        params.push(status);
      }

      query += ` LIMIT ? OFFSET ?`;
      params.push(limit, offset);

      const data = await this.debtRepository.query(query, params);

      // Count total
      let countQuery = `
        SELECT COUNT(*) as total FROM debts d
        WHERE d.deleted_at IS NULL
      `;
      const countParams: any[] = [];

      if (status) {
        countQuery += ` AND d.status = ?`;
        countParams.push(status);
      }

      const totalResult = await this.debtRepository.query(countQuery, countParams);
      const total = totalResult[0]?.total || 0;

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }
  }

  private generateDateRange(fromDate: string, toDate: string): string[] {
    const dates: string[] = [];
    const currentDate = new Date(fromDate);
    const endDate = new Date(toDate);

    while (currentDate <= endDate) {
      dates.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
  }

  async getAgingAnalysis(fromDate: string, toDate: string) {
    // Logic hybrid tương tự overview
    const today = new Date().toISOString().split('T')[0];
    const results: any[] = [];

    // Lấy dữ liệu từ debt_statistics cho các ngày trong quá khứ
    if (fromDate < today) {
      const endDateForHistory = toDate < today ? toDate : 
        new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const agingQuery = `
        SELECT 
          CASE 
            WHEN DATEDIFF(CURDATE(), due_date) <= 0 THEN 'current'
            WHEN DATEDIFF(CURDATE(), due_date) <= 30 THEN '1-30'
            WHEN DATEDIFF(CURDATE(), due_date) <= 60 THEN '31-60'
            WHEN DATEDIFF(CURDATE(), due_date) <= 90 THEN '61-90'
            ELSE '90+'
          END as age_range,
          COUNT(*) as count,
          SUM(remaining) as amount
        FROM debt_statistics
        WHERE statistic_date >= ? AND statistic_date <= ?
          AND status != 'paid'
        GROUP BY age_range
      `;

      const historyAging = await this.debtStatisticRepository.query(agingQuery, [fromDate, endDateForHistory]);
      results.push(...historyAging);
    }

    // Nếu toDate là hôm nay, lấy thêm dữ liệu realtime từ debts
    if (toDate >= today) {
      const currentAgingQuery = `
        SELECT 
          CASE 
            WHEN DATEDIFF(CURDATE(), due_date) <= 0 THEN 'current'
            WHEN DATEDIFF(CURDATE(), due_date) <= 30 THEN '1-30'
            WHEN DATEDIFF(CURDATE(), due_date) <= 60 THEN '31-60'
            WHEN DATEDIFF(CURDATE(), due_date) <= 90 THEN '61-90'
            ELSE '90+'
          END as age_range,
          COUNT(*) as count,
          SUM(remaining) as amount
        FROM debts
        WHERE deleted_at IS NULL AND status != 'paid'
        GROUP BY age_range
      `;

      const currentAging = await this.debtRepository.query(currentAgingQuery);
      
      // Merge results
      for (const current of currentAging) {
        const existing = results.find(r => r.age_range === current.age_range);
        if (existing) {
          existing.count = Number(existing.count) + Number(current.count);
          existing.amount = Number(existing.amount) + Number(current.amount);
        } else {
          results.push(current);
        }
      }
    }

    return results.map(item => ({
      range: item.age_range,
      count: Number(item.count) || 0,
      amount: Number(item.amount) || 0
    }));
  }

  async getTrends(fromDate: string, toDate: string, groupBy: 'day' | 'week' | 'month' = 'day') {
    // Tương tự như getTrendStatistics nhưng với tên khác
    return this.getTrendStatistics(fromDate, toDate, groupBy);
  }

  async getEmployeePerformance(fromDate: string, toDate: string) {
    const today = new Date().toISOString().split('T')[0];
    const results: any[] = [];

    // Lấy dữ liệu từ debt_statistics cho các ngày trong quá khứ
    if (fromDate < today) {
      const endDateForHistory = toDate < today ? toDate : 
        new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      const performanceQuery = `
        SELECT 
          sale_name_raw as employee_name,
          employee_code_raw as employee_code,
          COUNT(*) as total_debts,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_debts,
          SUM(total_amount) as total_amount,
          SUM(total_amount - remaining) as collected_amount,
          AVG(CASE WHEN status = 'paid' THEN DATEDIFF(updated_at, created_at) END) as avg_collection_days
        FROM debt_statistics
        WHERE statistic_date >= ? AND statistic_date <= ?
          AND sale_name_raw IS NOT NULL
        GROUP BY sale_name_raw, employee_code_raw
      `;

      const historyPerformance = await this.debtStatisticRepository.query(performanceQuery, [fromDate, endDateForHistory]);
      results.push(...historyPerformance);
    }

    // Nếu toDate là hôm nay, lấy thêm dữ liệu realtime từ debts
    if (toDate >= today) {
      const currentPerformanceQuery = `
        SELECT 
          sale_name_raw as employee_name,
          employee_code_raw as employee_code,
          COUNT(*) as total_debts,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_debts,
          SUM(total_amount) as total_amount,
          SUM(total_amount - remaining) as collected_amount,
          AVG(CASE WHEN status = 'paid' THEN DATEDIFF(updated_at, created_at) END) as avg_collection_days
        FROM debts
        WHERE deleted_at IS NULL
          AND sale_name_raw IS NOT NULL
        GROUP BY sale_name_raw, employee_code_raw
      `;

      const currentPerformance = await this.debtRepository.query(currentPerformanceQuery);
      
      // Merge results
      for (const current of currentPerformance) {
        const existing = results.find(r => 
          r.employee_code === current.employee_code && 
          r.employee_name === current.employee_name
        );
        if (existing) {
          existing.total_debts = Number(existing.total_debts) + Number(current.total_debts);
          existing.paid_debts = Number(existing.paid_debts) + Number(current.paid_debts);
          existing.total_amount = Number(existing.total_amount) + Number(current.total_amount);
          existing.collected_amount = Number(existing.collected_amount) + Number(current.collected_amount);
        } else {
          results.push(current);
        }
      }
    }

    return results.map(item => ({
      employee_name: item.employee_name,
      employee_code: item.employee_code,
      total_debts: Number(item.total_debts) || 0,
      paid_debts: Number(item.paid_debts) || 0,
      total_amount: Number(item.total_amount) || 0,
      collected_amount: Number(item.collected_amount) || 0,
      collection_rate: Number(item.total_debts) > 0 ? 
        (Number(item.paid_debts) / Number(item.total_debts) * 100) : 0,
      avg_collection_days: Number(item.avg_collection_days) || 0
    }));
  }
}
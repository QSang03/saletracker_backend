import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DebtStatistic } from './debt_statistic.entity';
import { Debt } from '../debts/debt.entity';
import { DebtLogs } from '../debt_logs/debt_logs.entity';
import { DebtHistory } from '../debt_histories/debt_histories.entity';

@Injectable()
export class DebtStatisticService {
  private readonly logger = new Logger(DebtStatisticService.name);

  private getVietnamToday(): string {
    const now = new Date();
    const vietnamTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return vietnamTime.toISOString().split('T')[0];
  }

  private normalizeDateOnly(input?: string): string | undefined {
    if (!input) return undefined;
    // Expect formats like YYYY-MM-DD or full ISO; take date part only
    try {
      if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
      const d = new Date(input);
      if (!Number.isNaN(d.getTime())) return d.toISOString().split('T')[0];
    } catch {}
    return undefined;
  }

  private resolveAsOfDate(params: { singleDate?: string; from?: string; to?: string }): string {
    const today = this.getVietnamToday();
    const sd = this.normalizeDateOnly(params.singleDate);
    const to = this.normalizeDateOnly(params.to);
    const from = this.normalizeDateOnly(params.from);
    return sd || to || from || today;
  }

  constructor(
    @InjectRepository(DebtStatistic)
    private readonly debtStatisticRepository: Repository<DebtStatistic>,
    @InjectRepository(Debt)
    private readonly debtRepository: Repository<Debt>,
    @InjectRepository(DebtLogs)
    private readonly debtLogsRepository: Repository<DebtLogs>,
    @InjectRepository(DebtHistory)
    private readonly debtHistoriesRepository: Repository<DebtHistory>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_11PM)
  async captureDailyStatistics() {
    // Snapshot toàn bộ trạng thái debts vào debt_statistics cho ngày hôm nay (+07)
    const today = this.getVietnamToday();
    try {
      const query = `
        INSERT INTO debt_statistics (
          statistic_date, customer_raw_code, invoice_code, bill_code,
          total_amount, remaining, issue_date, due_date, pay_later,
          status, sale_id, sale_name_raw, employee_code_raw,
          debt_config_id, customer_code, customer_name, note,
          is_notified, original_created_at, original_updated_at, original_debt_id
        )
        SELECT 
          ? as statistic_date,
          d.customer_raw_code, d.invoice_code, d.bill_code,
          d.total_amount, d.remaining, d.issue_date, d.due_date, d.pay_later,
          d.status, d.sale_id, d.sale_name_raw, d.employee_code_raw,
          d.debt_config_id, dc.customer_code, dc.customer_name, d.note,
          d.is_notified, d.created_at, d.updated_at, d.id
        FROM debts d
        LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
        WHERE d.deleted_at IS NULL
        ON DUPLICATE KEY UPDATE
          total_amount = VALUES(total_amount),
          remaining = VALUES(remaining),
          issue_date = VALUES(issue_date),
          due_date = VALUES(due_date),
          pay_later = VALUES(pay_later),
          status = VALUES(status),
          sale_id = VALUES(sale_id),
          sale_name_raw = VALUES(sale_name_raw),
          employee_code_raw = VALUES(employee_code_raw),
          debt_config_id = VALUES(debt_config_id),
          customer_code = VALUES(customer_code),
          customer_name = VALUES(customer_name),
          note = VALUES(note),
          is_notified = VALUES(is_notified),
          original_updated_at = VALUES(original_updated_at)
      `;
      await this.debtStatisticRepository.query(query, [today]);
      this.logger.log(`Captured snapshot for ${today} into debt_statistics (upsert).`);
    } catch (error) {
      this.logger.error(`Failed to capture debt statistics for ${today}:`, error);
      throw error;
    }
  }

  async getOverviewStatistics(fromDate: string, toDate: string) {
    const today = this.getVietnamToday();

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
      const endDateForHistory =
        toDate < today
          ? toDate
          : new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000)
              .toISOString()
              .split('T')[0];

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

      const historyStats = await this.debtStatisticRepository.query(
        historyQuery,
        [fromDate, endDateForHistory],
      );

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
      AND DATE(d.updated_at) = ?
  `;

      const todayStats = await this.debtRepository.query(todayQuery, [today]);

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

  async getTrendStatistics(
    fromDate: string,
    toDate: string,
    groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    const today = this.getVietnamToday();
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
        // Lấy từ debts với filter theo updated_at của ngày hiện tại
        const query = `
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
            SUM(CASE WHEN status = 'pay_later' THEN 1 ELSE 0 END) as pay_later,
            SUM(CASE WHEN status = 'no_information_available' THEN 1 ELSE 0 END) as no_info,
            SUM(total_amount) as totalAmount,
            AVG(CASE WHEN total_amount > 0 THEN ((total_amount - remaining) / total_amount) * 100 ELSE 0 END) as collectionRate
          FROM debts
          WHERE deleted_at IS NULL AND DATE(CONVERT_TZ(updated_at, '+00:00', '+07:00')) = ?
        `;

        const stats = await this.debtRepository.query(query, [date]);
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
    try {
      // Get today's date in the same timezone/format
      const today = this.getVietnamToday();

      const { date, from, to, status, contactStatus, mode, minDays, maxDays, employeeCode, customerCode, page = 1, limit = 10 } = filters;
      if (!date && (!from || !to)) {
        throw new Error('Either date or from/to parameters are required');
      }

      const offset = (page - 1) * limit;
      const D = (date || to || today) as string;
      const isHistoricalDate = D < today;

      // New: support range-based details to align with range aggregations (e.g., pay-later delay buckets)
      const isRange = !date && !!from && !!to;
      if (isRange && mode === 'payLater') {
        const dataCombined: any[] = [];
        let total = 0;

        // Historical snapshots part (from .. min(to, yesterday))
        if ((from as string) < today) {
          const endHistory = (to as string) < today
            ? (to as string)
            : new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000)
                .toISOString()
                .split('T')[0];

          const where: string[] = [
            'ds.statistic_date >= ? AND ds.statistic_date <= ?',
            "ds.status <> 'paid'",
            'ds.pay_later IS NOT NULL',
          ];
          const params: any[] = [from, endHistory];
          if (typeof minDays === 'number') {
            where.push('DATEDIFF(ds.statistic_date, ds.pay_later) >= ?');
            params.push(minDays);
          }
          if (typeof maxDays === 'number') {
            where.push('DATEDIFF(ds.statistic_date, ds.pay_later) <= ?');
            params.push(maxDays);
          }
          if (employeeCode) {
            where.push('ds.employee_code_raw = ?');
            params.push(employeeCode);
          }
          if (customerCode) {
            where.push('ds.customer_code = ?');
            params.push(customerCode);
          }
          const q = `SELECT ds.* FROM debt_statistics ds WHERE ${where.join(' AND ')}`;
          const rows = await this.debtStatisticRepository.query(q, params);
          dataCombined.push(...rows);
        }

        // Today's live debts part (only if range includes today)
        if ((to as string) >= today) {
          const whereToday: string[] = [
            'd.deleted_at IS NULL',
            "d.status <> 'paid'",
            'd.pay_later IS NOT NULL',
            "DATE(CONVERT_TZ(d.updated_at, '+00:00', '+07:00')) = ?",
          ];
          const paramsToday: any[] = [today];
          if (typeof minDays === 'number') {
            whereToday.push("DATEDIFF(DATE(CONVERT_TZ(d.updated_at, '+00:00', '+07:00')), d.pay_later) >= ?");
            paramsToday.push(minDays);
          }
          if (typeof maxDays === 'number') {
            whereToday.push("DATEDIFF(DATE(CONVERT_TZ(d.updated_at, '+00:00', '+07:00')), d.pay_later) <= ?");
            paramsToday.push(maxDays);
          }
          if (employeeCode) {
            whereToday.push('d.employee_code_raw = ?');
            paramsToday.push(employeeCode);
          }
          if (customerCode) {
            whereToday.push('dc.customer_code = ?');
            paramsToday.push(customerCode);
          }
          const qToday = `
            SELECT d.*, dc.customer_code, dc.customer_name
            FROM debts d
            LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
            WHERE ${whereToday.join(' AND ')}
          `;
          const rowsToday = await this.debtRepository.query(qToday, paramsToday);
          dataCombined.push(...rowsToday);
        }

        total = dataCombined.length;
        const data = dataCombined.slice(offset, offset + limit);
        return {
          data,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        };
      }

      // Range-based details for overdue (aging) to match aggregated buckets
      if (isRange && mode === 'overdue') {
        const dataCombined: any[] = [];
        let total = 0;

        if ((from as string) < today) {
          const endHistory = (to as string) < today
            ? (to as string)
            : new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000)
                .toISOString()
                .split('T')[0];

          const where: string[] = [
            'ds.statistic_date >= ? AND ds.statistic_date <= ?',
            "ds.status <> 'paid'",
            'ds.due_date IS NOT NULL',
            'DATEDIFF(ds.statistic_date, ds.due_date) > 0',
          ];
          const params: any[] = [from, endHistory];
          if (typeof minDays === 'number') {
            where.push('DATEDIFF(ds.statistic_date, ds.due_date) >= ?');
            params.push(minDays);
          }
          if (typeof maxDays === 'number') {
            where.push('DATEDIFF(ds.statistic_date, ds.due_date) <= ?');
            params.push(maxDays);
          }
          if (employeeCode) {
            where.push('ds.employee_code_raw = ?');
            params.push(employeeCode);
          }
          if (customerCode) {
            where.push('ds.customer_code = ?');
            params.push(customerCode);
          }
          const q = `SELECT ds.* FROM debt_statistics ds WHERE ${where.join(' AND ')}`;
          const rows = await this.debtStatisticRepository.query(q, params);
          dataCombined.push(...rows);
        }

        if ((to as string) >= today) {
          const whereToday: string[] = [
            'd.deleted_at IS NULL',
            "d.status <> 'paid'",
            'd.due_date IS NOT NULL',
            'DATEDIFF(DATE(CONVERT_TZ(d.updated_at, "+00:00", "+07:00")), d.due_date) > 0',
            'DATE(CONVERT_TZ(d.updated_at, "+00:00", "+07:00")) = ?',
          ];
          const paramsToday: any[] = [today];
          if (typeof minDays === 'number') {
            whereToday.push('DATEDIFF(DATE(CONVERT_TZ(d.updated_at, "+00:00", "+07:00")), d.due_date) >= ?');
            paramsToday.push(minDays);
          }
          if (typeof maxDays === 'number') {
            whereToday.push('DATEDIFF(DATE(CONVERT_TZ(d.updated_at, "+00:00", "+07:00")), d.due_date) <= ?');
            paramsToday.push(maxDays);
          }
          if (employeeCode) {
            whereToday.push('d.employee_code_raw = ?');
            paramsToday.push(employeeCode);
          }
          if (customerCode) {
            whereToday.push('dc.customer_code = ?');
            paramsToday.push(customerCode);
          }
          const qToday = `
            SELECT d.*, dc.customer_code, dc.customer_name
            FROM debts d
            LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
            WHERE ${whereToday.join(' AND ')}
          `;
          const rowsToday = await this.debtRepository.query(qToday, paramsToday);
          dataCombined.push(...rowsToday);
        }

        total = dataCombined.length;
        const data = dataCombined.slice(offset, offset + limit);
        return {
          data,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        };
      }

      if (isHistoricalDate) {
        let query = `
        SELECT ds.*
        FROM debt_statistics ds
        INNER JOIN (
          SELECT original_debt_id, MAX(statistic_date) AS last_date
          FROM debt_statistics
          WHERE statistic_date <= ?
          GROUP BY original_debt_id
        ) latest ON latest.original_debt_id = ds.original_debt_id AND latest.last_date = ds.statistic_date
        WHERE 1=1
      `;
        const params: any[] = [D];

        if (status) {
          query += ` AND ds.status = ?`;
          params.push(status);
        }

        if (mode === 'payLater') {
          if (typeof minDays === 'number') {
            query += ` AND DATEDIFF(?, ds.pay_later) >= ?`;
            params.push(D, minDays);
          }
          if (typeof maxDays === 'number') {
            query += ` AND DATEDIFF(?, ds.pay_later) <= ?`;
            params.push(D, maxDays);
          }
          query += ` AND ds.status <> 'paid' AND ds.pay_later IS NOT NULL`;
        }
        if (mode === 'overdue') {
          if (typeof minDays === 'number') {
            query += ` AND DATEDIFF(?, ds.due_date) >= ?`;
            params.push(D, minDays);
          }
          if (typeof maxDays === 'number') {
            query += ` AND DATEDIFF(?, ds.due_date) <= ?`;
            params.push(D, maxDays);
          }
          query += ` AND ds.status <> 'paid'`;
        }

        if (employeeCode) {
          query += ` AND ds.employee_code_raw = ?`;
          params.push(employeeCode);
        }
        if (customerCode) {
          query += ` AND ds.customer_code = ?`;
          params.push(customerCode);
        }

        query += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const data = await this.debtStatisticRepository.query(query, params);

        let countQuery = `
        SELECT COUNT(*) as total FROM (
          SELECT ds.id
          FROM debt_statistics ds
          INNER JOIN (
            SELECT original_debt_id, MAX(statistic_date) AS last_date
            FROM debt_statistics
            WHERE statistic_date <= ?
            GROUP BY original_debt_id
          ) latest ON latest.original_debt_id = ds.original_debt_id AND latest.last_date = ds.statistic_date
          WHERE 1=1
        `;
        const countParams: any[] = [D];

        if (status) {
          countQuery += ` AND ds.status = ?`;
          countParams.push(status);
        }

        if (mode === 'payLater') {
          if (typeof minDays === 'number') {
            countQuery += ` AND DATEDIFF(?, ds.pay_later) >= ?`;
            countParams.push(D, minDays);
          }
          if (typeof maxDays === 'number') {
            countQuery += ` AND DATEDIFF(?, ds.pay_later) <= ?`;
            countParams.push(D, maxDays);
          }
          countQuery += ` AND ds.status <> 'paid' AND ds.pay_later IS NOT NULL`;
        }
        if (mode === 'overdue') {
          if (typeof minDays === 'number') {
            countQuery += ` AND DATEDIFF(?, ds.due_date) >= ?`;
            countParams.push(D, minDays);
          }
          if (typeof maxDays === 'number') {
            countQuery += ` AND DATEDIFF(?, ds.due_date) <= ?`;
            countParams.push(D, maxDays);
          }
          countQuery += ` AND ds.status <> 'paid'`;
        }
        if (employeeCode) {
          countQuery += ` AND ds.employee_code_raw = ?`;
          countParams.push(employeeCode);
        }
        if (customerCode) {
          countQuery += ` AND ds.customer_code = ?`;
          countParams.push(customerCode);
        }

        countQuery += `) t`;
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
        let query = `
        SELECT d.*, dc.customer_code, dc.customer_name, u.full_name as sale_name
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
        if (mode === 'payLater') {
          if (typeof minDays === 'number') {
            query += ` AND DATEDIFF(?, d.pay_later) >= ?`;
            params.push(D, minDays);
          }
          if (typeof maxDays === 'number') {
            query += ` AND DATEDIFF(?, d.pay_later) <= ?`;
            params.push(D, maxDays);
          }
          query += ` AND d.status <> 'paid' AND d.pay_later IS NOT NULL`;
        }
        if (mode === 'overdue') {
          if (typeof minDays === 'number') {
            query += ` AND DATEDIFF(?, d.due_date) >= ?`;
            params.push(D, minDays);
          }
          if (typeof maxDays === 'number') {
            query += ` AND DATEDIFF(?, d.due_date) <= ?`;
            params.push(D, maxDays);
          }
          query += ` AND d.status <> 'paid'`;
        }
        if (employeeCode) {
          query += ` AND d.employee_code_raw = ?`;
          params.push(employeeCode);
        }
        if (customerCode) {
          query += ` AND dc.customer_code = ?`;
          params.push(customerCode);
        }
        query += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const data = await this.debtRepository.query(query, params);

        let countQuery = `
        SELECT COUNT(*) as total FROM debts d
        LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
        WHERE d.deleted_at IS NULL
      `;
        const countParams: any[] = [];

        if (status) {
          countQuery += ` AND d.status = ?`;
          countParams.push(status);
        }
        if (mode === 'payLater') {
          if (typeof minDays === 'number') {
            countQuery += ` AND DATEDIFF(?, d.pay_later) >= ?`;
            countParams.push(D, minDays);
          }
          if (typeof maxDays === 'number') {
            countQuery += ` AND DATEDIFF(?, d.pay_later) <= ?`;
            countParams.push(D, maxDays);
          }
          countQuery += ` AND d.status <> 'paid' AND d.pay_later IS NOT NULL`;
        }
        if (mode === 'overdue') {
          if (typeof minDays === 'number') {
            countQuery += ` AND DATEDIFF(?, d.due_date) >= ?`;
            countParams.push(D, minDays);
          }
          if (typeof maxDays === 'number') {
            countQuery += ` AND DATEDIFF(?, d.due_date) <= ?`;
            countParams.push(D, maxDays);
          }
          countQuery += ` AND d.status <> 'paid'`;
        }
        if (employeeCode) {
          countQuery += ` AND d.employee_code_raw = ?`;
          countParams.push(employeeCode);
        }
        if (customerCode) {
          countQuery += ` AND dc.customer_code = ?`;
          countParams.push(customerCode);
        }

        const totalResult = await this.debtRepository.query(
          countQuery,
          countParams,
        );
        const total = totalResult[0]?.total || 0;

        return {
          data,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        };
      }
    } catch (error) {
      this.logger.error('Error in getDetailedDebts:', error);
      throw error;
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
    // Logic hybrid theo snapshot: quá khứ theo statistic_date, hôm nay theo DATE(updated_at)
    const today = this.getVietnamToday();
    const results: any[] = [];

    // Quá khứ: dùng debt_statistics, tính DATEDIFF(statistic_date, due_date) và chỉ lấy khoản nợ đã quá hạn (>0)
    if (fromDate < today) {
      const endDateForHistory =
        toDate < today
          ? toDate
          : new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000)
              .toISOString()
              .split('T')[0];

      const agingQuery = `
        SELECT 
          CASE 
            WHEN DATEDIFF(ds.statistic_date, ds.due_date) BETWEEN 1 AND 30 THEN '1-30'
            WHEN DATEDIFF(ds.statistic_date, ds.due_date) BETWEEN 31 AND 60 THEN '31-60'
            WHEN DATEDIFF(ds.statistic_date, ds.due_date) BETWEEN 61 AND 90 THEN '61-90'
            ELSE '>90'
          END as age_range,
          COUNT(*) as count,
          SUM(ds.remaining) as amount
        FROM debt_statistics ds
        INNER JOIN (
          SELECT original_debt_id, MAX(statistic_date) AS last_date
          FROM debt_statistics
          WHERE statistic_date >= ? AND statistic_date <= ?
          GROUP BY original_debt_id
        ) latest ON latest.original_debt_id = ds.original_debt_id AND latest.last_date = ds.statistic_date
        WHERE ds.status != 'paid'
          AND DATEDIFF(ds.statistic_date, ds.due_date) > 0
        GROUP BY age_range
      `;

      const historyAging = await this.debtStatisticRepository.query(agingQuery, [fromDate, endDateForHistory]);
      results.push(...historyAging);
    }

    // Hôm nay: dùng debts, tính DATEDIFF(DATE(updated_at), due_date) và chỉ lấy quá hạn (>0)
    if (toDate >= today) {
      const currentAgingQuery = `
        SELECT 
          CASE 
            WHEN DATEDIFF(DATE(CONVERT_TZ(updated_at, '+00:00', '+07:00')), due_date) BETWEEN 1 AND 30 THEN '1-30'
            WHEN DATEDIFF(DATE(CONVERT_TZ(updated_at, '+00:00', '+07:00')), due_date) BETWEEN 31 AND 60 THEN '31-60'
            WHEN DATEDIFF(DATE(CONVERT_TZ(updated_at, '+00:00', '+07:00')), due_date) BETWEEN 61 AND 90 THEN '61-90'
            ELSE '>90'
          END as age_range,
          COUNT(*) as count,
          SUM(remaining) as amount
        FROM debts
        WHERE deleted_at IS NULL AND status != 'paid'
          AND DATE(CONVERT_TZ(updated_at, '+00:00', '+07:00')) = ?
          AND DATEDIFF(DATE(CONVERT_TZ(updated_at, '+00:00', '+07:00')), due_date) > 0
        GROUP BY age_range
      `;

      const currentAging = await this.debtRepository.query(currentAgingQuery, [today]);

      for (const current of currentAging) {
        const existing = results.find((r) => r.age_range === current.age_range);
        if (existing) {
          existing.count = Number(existing.count) + Number(current.count);
          existing.amount = Number(existing.amount) + Number(current.amount);
        } else {
          results.push(current);
        }
      }
    }

    return results.map((item) => ({
      range: item.age_range,
      count: Number(item.count) || 0,
      amount: Number(item.amount) || 0,
    }));
  }

  // New as-of implementation per plan: single D date determines snapshot selection
  async getAgingAnalysisAsOf(params: { singleDate?: string; from?: string; to?: string; employeeCode?: string; customerCode?: string }) {
    const D = this.resolveAsOfDate(params);
    const today = this.getVietnamToday();

    if (D < today) {
      const filters: string[] = [
        "ds.status <> 'paid'",
        'ds.due_date IS NOT NULL',
        'DATEDIFF(?, ds.due_date) > 0',
      ];
      const args: any[] = [D];
      if (params.employeeCode) {
        filters.push('ds.employee_code_raw = ?');
        args.push(params.employeeCode);
      }
      if (params.customerCode) {
        filters.push('ds.customer_code = ?');
        args.push(params.customerCode);
      }
      const query = `
        SELECT
          CASE
            WHEN DATEDIFF(?, ds.due_date) BETWEEN 1 AND 30 THEN '1-30'
            WHEN DATEDIFF(?, ds.due_date) BETWEEN 31 AND 60 THEN '31-60'
            WHEN DATEDIFF(?, ds.due_date) BETWEEN 61 AND 90 THEN '61-90'
            ELSE '>90'
          END AS bucket,
          COUNT(*) AS count,
          SUM(ds.remaining) AS amount
        FROM debt_statistics ds
        INNER JOIN (
          SELECT original_debt_id, MAX(statistic_date) AS snap_date
          FROM debt_statistics
          WHERE statistic_date <= ?
          GROUP BY original_debt_id
        ) latest
          ON latest.original_debt_id = ds.original_debt_id
          AND latest.snap_date = ds.statistic_date
        WHERE ${filters.join(' AND ')}
        GROUP BY bucket
        ORDER BY CASE bucket WHEN '1-30' THEN 1 WHEN '31-60' THEN 2 WHEN '61-90' THEN 3 ELSE 4 END
      `;
      // Placeholders:
      //  - 3 for SELECT DATEDIFF
      //  - 1 for latest.snap_date (<= ?)
      //  - remaining placeholders (including one D for WHERE DATEDIFF) come from ...args
      const rows = await this.debtStatisticRepository.query(query, [D, D, D, D, ...args]);
      return rows.map((r: any) => ({ range: r.bucket, count: Number(r.count) || 0, amount: Number(r.amount) || 0 }));
    } else {
      const where: string[] = [
        'd.deleted_at IS NULL',
        "d.status <> 'paid'",
        'd.due_date IS NOT NULL',
        'DATEDIFF(?, d.due_date) > 0',
      ];
      const arr: any[] = [D];
      if (params.employeeCode) {
        where.push('d.employee_code_raw = ?');
        arr.push(params.employeeCode);
      }
      if (params.customerCode) {
        where.push('dc.customer_code = ?');
        arr.push(params.customerCode);
      }
      const query = `
        SELECT
          CASE
            WHEN DATEDIFF(?, d.due_date) BETWEEN 1 AND 30 THEN '1-30'
            WHEN DATEDIFF(?, d.due_date) BETWEEN 31 AND 60 THEN '31-60'
            WHEN DATEDIFF(?, d.due_date) BETWEEN 61 AND 90 THEN '61-90'
            ELSE '>90'
          END AS bucket,
          COUNT(*) AS count,
          SUM(d.remaining) AS amount
        FROM debts d
        LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
        WHERE ${where.join(' AND ')}
        GROUP BY bucket
        ORDER BY CASE bucket WHEN '1-30' THEN 1 WHEN '31-60' THEN 2 WHEN '61-90' THEN 3 ELSE 4 END
      `;
      // Placeholders:
      //  - 3 for SELECT DATEDIFF
      //  - WHERE DATEDIFF placeholder provided in ...arr (arr starts with D)
      const rows = await this.debtRepository.query(query, [D, D, D, ...arr]);
      return rows.map((r: any) => ({ range: r.bucket, count: Number(r.count) || 0, amount: Number(r.amount) || 0 }));
    }
  }

  // New aggregate: pay-later delay and contact responses and details
  async getPayLaterDelay(
    fromDate: string,
    toDate: string,
    buckets: number[],
    options: { employeeCode?: string; customerCode?: string } = {},
  ) {
    const today = this.getVietnamToday();
    const sortedBuckets = [...buckets].sort((a, b) => a - b);
    const ranges: Array<{ label: string; min: number; max: number | null }> = [];
    let previous = 0;
    for (const b of sortedBuckets) {
      ranges.push({ label: `${previous + 1}-${b}`, min: previous + 1, max: b });
      previous = b;
    }
    ranges.push({ label: `>${previous}`, min: previous + 1, max: null });

    const resultsMap = new Map<string, { range: string; count: number; amount: number }>();
    for (const r of ranges) {
      resultsMap.set(r.label, { range: r.label, count: 0, amount: 0 });
    }

    if (fromDate < today) {
      const endDateForHistory = toDate < today
        ? toDate
        : new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0];

      const whereClauses: string[] = [
        'statistic_date >= ? AND statistic_date <= ? AND status <> "paid"',
        'pay_later IS NOT NULL',
      ];
      const params: any[] = [fromDate, endDateForHistory];
      if (options.employeeCode) {
        whereClauses.push('employee_code_raw = ?');
        params.push(options.employeeCode);
      }
      if (options.customerCode) {
        whereClauses.push('customer_code = ?');
        params.push(options.customerCode);
      }

      const diffExpr = 'DATEDIFF(statistic_date, pay_later)';
      const selects = ranges
        .map((r) => {
          const cond = r.max === null
            ? `${diffExpr} >= ${r.min}`
            : `${diffExpr} BETWEEN ${r.min} AND ${r.max}`;
          return `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS cnt_${r.label.replace(/[^a-zA-Z0-9_]/g, '_')},` +
                 ` SUM(CASE WHEN ${cond} THEN remaining ELSE 0 END) AS amt_${r.label.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        })
        .join(',');

      const query = `SELECT ${selects} FROM debt_statistics WHERE ${whereClauses.join(' AND ')}`;
      const rows = await this.debtStatisticRepository.query(query, params);
      if (rows && rows[0]) {
        const row = rows[0];
        for (const r of ranges) {
          const key = r.label.replace(/[^a-zA-Z0-9_]/g, '_');
          const cnt = Number(row[`cnt_${key}`]) || 0;
          const amt = Number(row[`amt_${key}`]) || 0;
          const agg = resultsMap.get(r.label)!;
          agg.count += cnt;
          agg.amount += amt;
        }
      }
    }

    if (toDate >= today) {
      const whereClauses: string[] = [
        'd.deleted_at IS NULL',
        "d.status <> 'paid'",
        'd.pay_later IS NOT NULL',
        "DATE(CONVERT_TZ(d.updated_at, '+00:00', '+07:00')) = ?",
      ];
      const params: any[] = [today];
      if (options.employeeCode) {
        whereClauses.push('d.employee_code_raw = ?');
        params.push(options.employeeCode);
      }
      if (options.customerCode) {
        whereClauses.push('dc.customer_code = ?');
        params.push(options.customerCode);
      }

      const diffExpr = "DATEDIFF(DATE(CONVERT_TZ(d.updated_at, '+00:00', '+07:00')), d.pay_later)";
      const selects = ranges
        .map((r) => {
          const cond = r.max === null
            ? `${diffExpr} >= ${r.min}`
            : `${diffExpr} BETWEEN ${r.min} AND ${r.max}`;
          return `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS cnt_${r.label.replace(/[^a-zA-Z0-9_]/g, '_')},` +
                 ` SUM(CASE WHEN ${cond} THEN d.remaining ELSE 0 END) AS amt_${r.label.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        })
        .join(',');

      const query = `SELECT ${selects} FROM debts d LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id WHERE ${whereClauses.join(' AND ')}`;
      const rows = await this.debtRepository.query(query, params);
      if (rows && rows[0]) {
        const row = rows[0];
        for (const r of ranges) {
          const key = r.label.replace(/[^a-zA-Z0-9_]/g, '_');
          const cnt = Number(row[`cnt_${key}`]) || 0;
          const amt = Number(row[`amt_${key}`]) || 0;
          const agg = resultsMap.get(r.label)!;
          agg.count += cnt;
          agg.amount += amt;
        }
      }
    }

    return Array.from(resultsMap.values());
  }

  // New as-of implementation for pay-later delay buckets
  async getPayLaterDelayAsOf(params: { singleDate?: string; from?: string; to?: string; buckets: number[]; employeeCode?: string; customerCode?: string }) {
    const D = this.resolveAsOfDate(params);
    const today = this.getVietnamToday();
    const sorted = [...params.buckets].sort((a, b) => a - b);
    const ranges: Array<{ label: string; min: number; max: number | null }> = [];
    let prev = 0;
    for (const b of sorted) {
      ranges.push({ label: `${prev + 1}-${b}`, min: prev + 1, max: b });
      prev = b;
    }
    ranges.push({ label: `>${prev}`, min: prev + 1, max: null });

    const buildCase = (diffExpr: string) => {
      const whenClauses = ranges
        .map((r) => {
          const cond = r.max == null ? `${diffExpr} >= ${r.min}` : `${diffExpr} BETWEEN ${r.min} AND ${r.max}`;
          return `WHEN ${cond} THEN '${r.label}'`;
        })
        .join(' ');
      return `CASE WHEN ${diffExpr} > 0 THEN (${`CASE ${whenClauses} ELSE NULL END`}) ELSE NULL END`;
    };

    if (D < today) {
      const filters: string[] = [
        "ds.status <> 'paid'",
        'ds.pay_later IS NOT NULL',
      ];
      const arr: any[] = [];
      if (params.employeeCode) {
        filters.push('ds.employee_code_raw = ?');
        arr.push(params.employeeCode);
      }
      if (params.customerCode) {
        filters.push('ds.customer_code = ?');
        arr.push(params.customerCode);
      }
      const caseExpr = buildCase('DATEDIFF(?, ds.pay_later)');
      const query = `
        SELECT rng AS bucket, COUNT(*) AS count, SUM(ds.remaining) AS amount
        FROM (
          SELECT ${caseExpr} AS rng, ds.remaining
          FROM debt_statistics ds
          INNER JOIN (
            SELECT original_debt_id, MAX(statistic_date) AS snap_date
            FROM debt_statistics
            WHERE statistic_date <= ?
            GROUP BY original_debt_id
          ) latest
            ON latest.original_debt_id = ds.original_debt_id
            AND latest.snap_date = ds.statistic_date
          WHERE ${filters.join(' AND ')}
        ) t
        WHERE rng IS NOT NULL
        GROUP BY rng
        ORDER BY CASE rng ${ranges.map((r, idx) => `WHEN '${r.label}' THEN ${idx + 1}`).join(' ')} ELSE 999 END
      `;
      // Placeholders: one for caseExpr (DATEDIFF), one for latest.snap_date compare
      const rows = await this.debtStatisticRepository.query(query, [D, D, ...arr]);
      return rows.map((r: any) => ({ range: r.bucket, count: Number(r.count) || 0, amount: Number(r.amount) || 0 }));
    } else {
      const where: string[] = [
        'd.deleted_at IS NULL',
        "d.status <> 'paid'",
        'd.pay_later IS NOT NULL',
      ];
      const arr: any[] = [];
      if (params.employeeCode) {
        where.push('d.employee_code_raw = ?');
        arr.push(params.employeeCode);
      }
      if (params.customerCode) {
        where.push('dc.customer_code = ?');
        arr.push(params.customerCode);
      }
      const caseExpr = buildCase('DATEDIFF(?, d.pay_later)');
      const query = `
        SELECT rng AS bucket, COUNT(*) AS count, SUM(d.remaining) AS amount
        FROM (
          SELECT ${caseExpr} AS rng, d.remaining
          FROM debts d
          LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
          WHERE ${where.join(' AND ')}
        ) t
        WHERE rng IS NOT NULL
        GROUP BY rng
        ORDER BY CASE rng ${ranges
          .map((r, idx) => `WHEN '${r.label}' THEN ${idx + 1}`)
          .join(' ')} ELSE 999 END
      `;
      // Placeholders: one for caseExpr (DATEDIFF)
      const rows = await this.debtRepository.query(query, [D, ...arr]);
      return rows.map((r: any) => ({ range: r.bucket, count: Number(r.count) || 0, amount: Number(r.amount) || 0 }));
    }
  }

  async getContactResponses(
    fromDate: string,
    toDate: string,
    by: 'customer' | 'invoice' = 'customer',
    options: { employeeCode?: string; customerCode?: string; mode?: 'events' | 'distribution' } = {},
  ) {
    const today = this.getVietnamToday();
    const resultsMap = new Map<string, { status: string; customers: number }>();

    const addCount = (status: string, count: number) => {
      const key = status || 'Unknown';
      const existing = resultsMap.get(key) || { status: key, customers: 0 };
      existing.customers += count;
      resultsMap.set(key, existing);
    };

    const mode = options.mode || 'events';

    // Mode events: đếm sự kiện trong khoảng [from, to] thuần theo debt_histories (UTC+7)
    if (mode === 'events') {
      const whereClauses = [
        "DATE(CONVERT_TZ(dh.created_at, '+00:00', '+07:00')) >= ? AND DATE(CONVERT_TZ(dh.created_at, '+00:00', '+07:00')) <= ?",
      ];
      const params: any[] = [fromDate, toDate];
      if (options.employeeCode) {
        whereClauses.push('u.employee_code = ?');
        params.push(options.employeeCode);
      }
      if (options.customerCode) {
        whereClauses.push('dc.customer_code = ?');
        params.push(options.customerCode);
      }
      const selectDistinct = by === 'customer' ? 'COUNT(DISTINCT dc.customer_code)' : 'COUNT(*)';
      const query = `
        SELECT dh.remind_status as status, ${selectDistinct} as customers
        FROM debt_histories dh
        LEFT JOIN debt_logs dl ON dh.debt_log_id = dl.id
        LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
        LEFT JOIN users u ON dc.employee_id = u.id
        WHERE ${whereClauses.join(' AND ')}
        GROUP BY dh.remind_status
      `;
      const rows = await this.debtHistoriesRepository.query(query, params);
      for (const r of rows) {
        addCount(r.status, Number(r.customers) || 0);
      }
    }

    // Distribution as-of today (current state), ignore range; only valid for today
    if (mode === 'distribution') {
      const whereClauses = [ '1=1' ];
      const params: any[] = [];
      if (options.employeeCode) {
        whereClauses.push('u.employee_code = ?');
        params.push(options.employeeCode);
      }
      if (options.customerCode) {
        whereClauses.push('dc.customer_code = ?');
        params.push(options.customerCode);
      }
      const selectDistinct = by === 'customer' ? 'COUNT(DISTINCT dc.customer_code)' : 'COUNT(*)';
      const query = `
        SELECT dl.remind_status as status, ${selectDistinct} as customers
        FROM debt_logs dl
        LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
        LEFT JOIN users u ON dc.employee_id = u.id
        WHERE ${whereClauses.join(' AND ')}
        GROUP BY dl.remind_status
      `;
      const rows = await this.debtLogsRepository.query(query, params);
      for (const r of rows) {
        addCount(r.status, Number(r.customers) || 0);
      }
    }

    return Array.from(resultsMap.values());
  }

  async getContactDetails(params: {
    date?: string;
    from?: string;
    to?: string;
    responseStatus: string;
    mode?: 'events' | 'distribution';
    employeeCode?: string;
    customerCode?: string;
    page?: number;
    limit?: number;
  }) {
    const { date, from, to, responseStatus, mode = 'events', employeeCode, customerCode, page = 1, limit = 50 } = params;
    const today = this.getVietnamToday();
    const offset = (page - 1) * limit;

    // Range mode (events): list distinct customers having that response in [from, to]
    if (!date && from && to && mode === 'events') {
      const where: string[] = [
        "DATE(CONVERT_TZ(dh.created_at, '+00:00', '+07:00')) >= ?",
        "DATE(CONVERT_TZ(dh.created_at, '+00:00', '+07:00')) <= ?",
        'dh.remind_status = ?',
      ];
      const arr: any[] = [from, to, responseStatus];
      if (employeeCode) { where.push('u.employee_code = ?'); arr.push(employeeCode); }
      if (customerCode) { where.push('dc.customer_code = ?'); arr.push(customerCode); }

      const dataQuery = `
        SELECT dc.customer_code, dc.customer_name, u.employee_code as employee_code_raw, MAX(dh.created_at) as latest_time
        FROM debt_histories dh
        LEFT JOIN debt_logs dl ON dh.debt_log_id = dl.id
        LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
        LEFT JOIN users u ON dc.employee_id = u.id
        WHERE ${where.join(' AND ')}
        GROUP BY dc.customer_code, dc.customer_name, u.employee_code
        ORDER BY latest_time DESC
        LIMIT ? OFFSET ?
      `;
      const dataParams = [...arr, limit, offset];
      const data = await this.debtHistoriesRepository.query(dataQuery, dataParams);

      const countQuery = `
        SELECT COUNT(*) as total FROM (
          SELECT dc.customer_code
          FROM debt_histories dh
          LEFT JOIN debt_logs dl ON dh.debt_log_id = dl.id
          LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
          LEFT JOIN users u ON dc.employee_id = u.id
          WHERE ${where.join(' AND ')}
          GROUP BY dc.customer_code
        ) t
      `;
      const totalRow = await this.debtHistoriesRepository.query(countQuery, arr);
      const total = Number(totalRow[0]?.total) || 0;
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    const isHistorical = (date || today) < today;

    if (isHistorical) {
      const where: string[] = [
        "DATE(CONVERT_TZ(dh.created_at, '+00:00', '+07:00')) = ?",
        'dh.remind_status = ?'
      ];
      const arr: any[] = [date, responseStatus];
      if (employeeCode) {
        where.push('u.employee_code = ?');
        arr.push(employeeCode);
      }
      if (customerCode) {
        where.push('dc.customer_code = ?');
        arr.push(customerCode);
      }
      const dataQuery = `
        SELECT dc.customer_code, dc.customer_name, u.employee_code as employee_code_raw, MAX(dh.created_at) as latest_time
        FROM debt_histories dh
        LEFT JOIN debt_logs dl ON dh.debt_log_id = dl.id
        LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
        LEFT JOIN users u ON dc.employee_id = u.id
        WHERE ${where.join(' AND ')}
        GROUP BY dc.customer_code, dc.customer_name, u.employee_code
        ORDER BY latest_time DESC
        LIMIT ? OFFSET ?
      `;
      const dataParams = [...arr, limit, offset];
      const data = await this.debtHistoriesRepository.query(dataQuery, dataParams);

      const countQuery = `
        SELECT COUNT(*) as total FROM (
          SELECT dc.customer_code
          FROM debt_histories dh
          LEFT JOIN debt_logs dl ON dh.debt_log_id = dl.id
          LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
          LEFT JOIN users u ON dc.employee_id = u.id
          WHERE ${where.join(' AND ')}
          GROUP BY dc.customer_code
        ) t
      `;
      const totalRow = await this.debtHistoriesRepository.query(countQuery, arr);
      const total = Number(totalRow[0]?.total) || 0;
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    } else {
      const where: string[] = [
        'DATE(CONVERT_TZ(dl.updated_at, "+00:00", "+07:00")) = ?',
        'dl.remind_status = ?'
      ];
      const arr: any[] = [today, responseStatus];
      if (employeeCode) {
        where.push('u.employee_code = ?');
        arr.push(employeeCode);
      }
      if (customerCode) {
        where.push('dc.customer_code = ?');
        arr.push(customerCode);
      }
      const dataQuery = `
        SELECT dc.customer_code, dc.customer_name, u.employee_code as employee_code_raw, MAX(dl.updated_at) as latest_time
        FROM debt_logs dl
        LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
        LEFT JOIN users u ON dc.employee_id = u.id
        WHERE ${where.join(' AND ')}
        GROUP BY dc.customer_code, dc.customer_name, u.employee_code
        ORDER BY latest_time DESC
        LIMIT ? OFFSET ?
      `;
      const dataParams = [...arr, limit, offset];
      const data = await this.debtLogsRepository.query(dataQuery, dataParams);

      const countQuery = `
        SELECT COUNT(*) as total FROM (
          SELECT dc.customer_code
          FROM debt_logs dl
          LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
          LEFT JOIN users u ON dc.employee_id = u.id
          WHERE ${where.join(' AND ')}
          GROUP BY dc.customer_code
        ) t
      `;
      const totalRow = await this.debtLogsRepository.query(countQuery, arr);
      const total = Number(totalRow[0]?.total) || 0;
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    }
  }

  async getTrends(
    fromDate: string,
    toDate: string,
    groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    // Tương tự như getTrendStatistics nhưng với tên khác
    return this.getTrendStatistics(fromDate, toDate, groupBy);
  }

  async getEmployeePerformance(fromDate: string, toDate: string) {
    const today = new Date().toISOString().split('T')[0];
    const results: any[] = [];

    // Lấy dữ liệu từ debt_statistics cho các ngày trong quá khứ
    if (fromDate < today) {
      const endDateForHistory =
        toDate < today
          ? toDate
          : new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000)
              .toISOString()
              .split('T')[0];

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

      const historyPerformance = await this.debtStatisticRepository.query(
        performanceQuery,
        [fromDate, endDateForHistory],
      );
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

      const currentPerformance = await this.debtRepository.query(
        currentPerformanceQuery,
      );

      // Merge results
      for (const current of currentPerformance) {
        const existing = results.find(
          (r) =>
            r.employee_code === current.employee_code &&
            r.employee_name === current.employee_name,
        );
        if (existing) {
          existing.total_debts =
            Number(existing.total_debts) + Number(current.total_debts);
          existing.paid_debts =
            Number(existing.paid_debts) + Number(current.paid_debts);
          existing.total_amount =
            Number(existing.total_amount) + Number(current.total_amount);
          existing.collected_amount =
            Number(existing.collected_amount) +
            Number(current.collected_amount);
        } else {
          results.push(current);
        }
      }
    }

    return results.map((item) => ({
      employeeCode: item.employee_code || item.employee_name, // fallback to name if code missing
      totalAssigned: Number(item.total_debts) || 0,
      totalCollected: Number(item.paid_debts) || 0,
      totalAmount: Number(item.total_amount) || 0,
      collectedAmount: Number(item.collected_amount) || 0,
      collectionRate:
        Number(item.total_debts) > 0
          ? (Number(item.paid_debts) / Number(item.total_debts)) * 100
          : 0,
      avgDebtAmount:
        Number(item.total_debts) > 0
          ? Number(item.total_amount) / Number(item.total_debts)
          : 0,
    }));
  }
}

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
    return now.toISOString().split('T')[0];
  }

  // Format date to Vietnam timezone for MySQL queries (without CONVERT_TZ)
  private formatToVietnamDate(date: Date): string {
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  // Format date string to Vietnam timezone
  private formatDateStringToVietnam(dateStr: string): string {
    return dateStr + ' 00:00:00';
  }

  // Helper to format date for MySQL queries (optimized for index usage)
  private formatDateForMySQL(dateStr: string): string {
    return dateStr + ' 00:00:00';
  }

  // Helper to format date range for MySQL queries
  private formatDateRangeForMySQL(fromDate: string, toDate: string): { from: string; to: string } {
    return {
      from: this.formatDateForMySQL(fromDate),
      to: this.formatDateForMySQL(toDate)
    };
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
    
    // Ưu tiên ngày được truyền vào, chỉ fallback về hôm nay khi thực sự cần thiết
    const resolvedDate = sd || to || from;
    
    // Nếu không có ngày nào được truyền vào, mới dùng hôm nay
    if (!resolvedDate) {
      return today;
    }
    
    // Nếu ngày được chọn là tương lai, chỉ trả về ngày hiện tại
    return resolvedDate > today ? today : resolvedDate;
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
    } catch (error) {
      this.logger.error(`Failed to capture debt statistics for ${today}:`, error);
      throw error;
    }
  }

  async getOverviewStatistics(fromDate: string, toDate: string, filters?: { employeeCode?: string; customerCode?: string }) {
    const today = this.getVietnamToday();
    
    // Nếu toDate là tương lai, chỉ tính đến ngày hiện tại
    const effectiveToDate = toDate > today ? today : toDate;

    // Phase 1.2: Tối ưu hóa - Gộp logic phức tạp bằng UNION ALL
    const buildUnionQuery = () => {
      const historyPart = `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
          SUM(CASE WHEN status = 'pay_later' THEN 1 ELSE 0 END) as payLater,
          SUM(CASE WHEN status = 'no_information_available' THEN 1 ELSE 0 END) as noInfo,
          SUM(total_amount) as totalAmount,
          SUM(total_amount - remaining) as collectedAmount,
          SUM(remaining) as remainingAmount,
          'history' as source
        FROM debt_statistics
        WHERE statistic_date >= ? AND statistic_date <= ?
      `;

      const todayPart = `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
          SUM(CASE WHEN status = 'pay_later' THEN 1 ELSE 0 END) as payLater,
          SUM(CASE WHEN status = 'no_information_available' THEN 1 ELSE 0 END) as noInfo,
          SUM(total_amount) as totalAmount,
          SUM(total_amount - remaining) as collectedAmount,
          SUM(remaining) as remainingAmount,
          'today' as source
        FROM debts
        WHERE deleted_at IS NULL AND DATE(updated_at) = DATE(?)
      `;

      return { historyPart, todayPart };
    };

    const { historyPart, todayPart } = buildUnionQuery();
    const params: any[] = [];
    let unionQuery = '';

    // Xử lý các ngày trong quá khứ từ debt_statistics
    if (fromDate < today) {
      const endDateForHistory =
        effectiveToDate < today
          ? effectiveToDate
          : new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000)
              .toISOString()
              .split('T')[0];

      let historyQuery = historyPart;
      params.push(fromDate, endDateForHistory);
      
      if (filters?.employeeCode) {
        historyQuery += ` AND employee_code_raw = ?`;
        params.push(filters.employeeCode);
      }
      
      if (filters?.customerCode) {
        historyQuery += ` AND customer_code = ?`;
        params.push(filters.customerCode);
      }

      unionQuery = historyQuery;
    }

    // Xử lý ngày hôm nay từ debts
    if (effectiveToDate >= today) {
      const todayVietnam = this.formatDateStringToVietnam(today);
      let todayQuery = todayPart;
      params.push(todayVietnam);
      
      if (filters?.employeeCode) {
        todayQuery += ` AND employee_code_raw = ?`;
        params.push(filters.employeeCode);
      }
      
      if (filters?.customerCode) {
        todayQuery += ` AND customer_code = ?`;
        params.push(filters.customerCode);
      }

      if (unionQuery) {
        unionQuery += ' UNION ALL ' + todayQuery;
      } else {
        unionQuery = todayQuery;
      }
    }

    // Phase 1.2: Tối ưu hóa - Gộp dữ liệu từ debt_statistics và debts trong 1 query
    const finalQuery = `
      SELECT 
        SUM(total) as total,
        SUM(paid) as paid,
        SUM(payLater) as payLater,
        SUM(noInfo) as noInfo,
        SUM(totalAmount) as totalAmount,
        SUM(collectedAmount) as collectedAmount,
        SUM(remainingAmount) as remainingAmount
      FROM (${unionQuery}) as combined_data
    `;

    const stats = await this.debtStatisticRepository.query(finalQuery, params);
    const result = stats[0] || {};

    const results = {
      total: Number(result.total) || 0,
      paid: Number(result.paid) || 0,
      payLater: Number(result.payLater) || 0,
      noInfo: Number(result.noInfo) || 0,
      totalAmount: Number(result.totalAmount) || 0,
      collectedAmount: Number(result.collectedAmount) || 0,
      remainingAmount: Number(result.remainingAmount) || 0,
      collectionRate: 0,
    };

    // Phase 1.2: Tối ưu hóa - Chuyển aggregation từ application layer sang database
    if (results.totalAmount > 0) {
      results.collectionRate = (results.collectedAmount / results.totalAmount) * 100;
    }

    return results;
  }

  async getTrendStatistics(
    fromDate: string,
    toDate: string,
    groupBy: 'day' | 'week' | 'month' = 'day',
  ) {
    const today = this.getVietnamToday();
    
    // Nếu toDate là tương lai, chỉ tính đến ngày hiện tại
    const effectiveToDate = toDate > today ? today : toDate;
    
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

    // Generate date range (skip Sundays)
    const dates = this.generateDateRange(fromDate, effectiveToDate).filter((d) => new Date(d).getDay() !== 0);

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
        // Ngày hiện tại: Lấy từ debts (real-time) - BÌNH THƯỜNG
        // Format today to Vietnam timezone for MySQL query
        const todayVietnam = this.formatDateStringToVietnam(today);
        const query = `
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
            SUM(CASE WHEN status = 'pay_later' THEN 1 ELSE 0 END) as pay_later,
            SUM(CASE WHEN status = 'no_information_available' THEN 1 ELSE 0 END) as no_info,
            SUM(total_amount) as totalAmount,
            AVG(CASE WHEN total_amount > 0 THEN ((total_amount - remaining) / total_amount) * 100 ELSE 0 END) as collectionRate
          FROM debts
          WHERE deleted_at IS NULL AND DATE(updated_at) = DATE(?)
        `;

        const stats = await this.debtRepository.query(query, [todayVietnam]);
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
      // Không fallback về today - phải có date hoặc to được truyền vào
      const D = (date || to) as string;
      if (!D) {
        throw new Error('Either date or to parameter is required');
      }
      const isHistoricalDate = D < today;

      // New: support range-based details to align with range aggregations (e.g., pay-later delay buckets)
      const isRange = !date && !!from && !!to;
      if (isRange && mode === 'payLater') {
        const dataCombined: any[] = [];
        let total = 0;

        // Nếu to là tương lai, chỉ tính đến ngày hiện tại
        const effectiveTo = (to as string) > today ? today : (to as string);

        // Historical snapshots part (from .. min(to, yesterday))
        if ((from as string) < today) {
          const endHistory = effectiveTo < today
            ? effectiveTo
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
        if (effectiveTo >= today) {
          // Format today to Vietnam timezone for MySQL query (optimized for index)
          const todayVietnam = this.formatDateStringToVietnam(today);
          const whereToday: string[] = [
            'd.deleted_at IS NULL',
            "d.status <> 'paid'",
            'd.pay_later IS NOT NULL',
            "DATE(d.updated_at) = DATE(?)",
          ];
          const paramsToday: any[] = [todayVietnam];
          if (typeof minDays === 'number') {
            whereToday.push("DATEDIFF(DATE(d.updated_at), d.pay_later) >= ?");
            paramsToday.push(minDays);
          }
          if (typeof maxDays === 'number') {
            whereToday.push("DATEDIFF(DATE(d.updated_at), d.pay_later) <= ?");
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

        // Nếu to là tương lai, chỉ tính đến ngày hiện tại
        const effectiveTo = (to as string) > today ? today : (to as string);

        if ((from as string) < today) {
          const endHistory = effectiveTo < today
            ? effectiveTo
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

        if (effectiveTo >= today) {
          // Format today to Vietnam timezone for MySQL query (optimized for index)
          const todayVietnam = this.formatDateStringToVietnam(today);
          const whereToday: string[] = [
            'd.deleted_at IS NULL',
            "d.status <> 'paid'",
            'd.due_date IS NOT NULL',
            'DATEDIFF(DATE(d.updated_at), d.due_date) > 0',
            'DATE(d.updated_at) = DATE(?)',
          ];
          const paramsToday: any[] = [todayVietnam];
          if (typeof minDays === 'number') {
            whereToday.push('DATEDIFF(DATE(d.updated_at), d.due_date) >= ?');
            paramsToday.push(minDays);
          }
          if (typeof maxDays === 'number') {
            whereToday.push('DATEDIFF(DATE(d.updated_at), d.due_date) <= ?');
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

      // Đảm bảo tính nhất quán: nếu là ngày quá khứ thì luôn lấy từ debt_statistics
      if (isHistoricalDate) {
        // Tất cả các trường hợp cho ngày quá khứ đều lấy từ debt_statistics để đồng nhất với biểu đồ
        let query = `
        SELECT ds.*
        FROM debt_statistics ds
        WHERE ds.statistic_date = ?
      `;
        const params: any[] = [D];

        if (status) {
          query += ` AND ds.status = ?`;
          params.push(status);
        }

        if (mode === 'payLater') {
          if (typeof minDays === 'number') {
            query += ` AND DATEDIFF(ds.statistic_date, ds.pay_later) >= ?`;
            params.push(minDays);
          }
          if (typeof maxDays === 'number') {
            query += ` AND DATEDIFF(ds.statistic_date, ds.pay_later) <= ?`;
            params.push(maxDays);
          }
          query += ` AND ds.status <> 'paid' AND ds.pay_later IS NOT NULL`;
        }
        if (mode === 'overdue') {
          if (typeof minDays === 'number') {
            query += ` AND DATEDIFF(ds.statistic_date, ds.due_date) >= ?`;
            params.push(minDays);
          }
          if (typeof maxDays === 'number') {
            query += ` AND DATEDIFF(ds.statistic_date, ds.due_date) <= ?`;
            params.push(maxDays);
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
        SELECT COUNT(*) as total FROM debt_statistics ds
        WHERE ds.statistic_date = ?
      `;
        const countParams: any[] = [D];

        if (status) {
          countQuery += ` AND ds.status = ?`;
          countParams.push(status);
        }

        if (mode === 'payLater') {
          if (typeof minDays === 'number') {
            countQuery += ` AND DATEDIFF(ds.statistic_date, ds.pay_later) >= ?`;
            countParams.push(minDays);
          }
          if (typeof maxDays === 'number') {
            countQuery += ` AND DATEDIFF(ds.statistic_date, ds.pay_later) <= ?`;
            countParams.push(maxDays);
          }
          countQuery += ` AND ds.status <> 'paid' AND ds.pay_later IS NOT NULL`;
        }
        if (mode === 'overdue') {
          if (typeof minDays === 'number') {
            countQuery += ` AND DATEDIFF(ds.statistic_date, ds.due_date) >= ?`;
            countParams.push(minDays);
          }
          if (typeof maxDays === 'number') {
            countQuery += ` AND DATEDIFF(ds.statistic_date, ds.due_date) <= ?`;
            countParams.push(maxDays);
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
        // Ngày hiện tại: Lấy từ debts (real-time) - BÌNH THƯỜNG
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
        // Align with trends/overview: restrict to selected as-of day for today's data
        if (date) {
          // Format date to Vietnam timezone for MySQL query (optimized for index)
          const dateVietnam = this.formatDateStringToVietnam(date);
          query += ` AND DATE(d.updated_at) = DATE(?)`;
          params.push(dateVietnam);
        }
        if (mode === 'payLater') {
          if (typeof minDays === 'number') {
            query += ` AND DATEDIFF(DATE(d.updated_at), d.pay_later) >= ?`;
            params.push(minDays);
          }
          if (typeof maxDays === 'number') {
            query += ` AND DATEDIFF(DATE(d.updated_at), d.pay_later) <= ?`;
            params.push(maxDays);
          }
          query += ` AND d.status <> 'paid' AND d.pay_later IS NOT NULL`;
        }
        if (mode === 'overdue') {
          if (typeof minDays === 'number') {
            query += ` AND DATEDIFF(DATE(d.updated_at), d.due_date) >= ?`;
            params.push(minDays);
          }
          if (typeof maxDays === 'number') {
            query += ` AND DATEDIFF(DATE(d.updated_at), d.due_date) <= ?`;
            params.push(maxDays);
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
        if (date) {
          // Format date to Vietnam timezone for MySQL query (optimized for index)
          const dateVietnam = this.formatDateStringToVietnam(date);
          countQuery += ` AND DATE(d.updated_at) = DATE(?)`;
          countParams.push(dateVietnam);
        }
        if (mode === 'payLater') {
          if (typeof minDays === 'number') {
            countQuery += ` AND DATEDIFF(DATE(d.updated_at), d.pay_later) >= ?`;
            countParams.push(minDays);
          }
          if (typeof maxDays === 'number') {
            countQuery += ` AND DATEDIFF(DATE(d.updated_at), d.pay_later) <= ?`;
            countParams.push(maxDays);
          }
          countQuery += ` AND d.status <> 'paid' AND d.pay_later IS NOT NULL`;
        }
        if (mode === 'overdue') {
          if (typeof minDays === 'number') {
            countQuery += ` AND DATEDIFF(DATE(d.updated_at), d.due_date) >= ?`;
            countParams.push(minDays);
          }
          if (typeof maxDays === 'number') {
            countQuery += ` AND DATEDIFF(DATE(d.updated_at), d.due_date) <= ?`;
            countParams.push(maxDays);
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

        const result = {
          data,
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        };
        
        return result;
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
    // Phase 1.3: Tối ưu hóa - Sử dụng CASE WHEN để phân nhóm trực tiếp trong SQL
    const today = this.getVietnamToday();
    
    // Nếu toDate là tương lai, chỉ tính đến ngày hiện tại
    const effectiveToDate = toDate > today ? today : toDate;
    
    // Phase 1.3: Tối ưu hóa - Gộp logic xử lý ngày quá khứ và hiện tại
    const buildAgingUnionQuery = () => {
      const historyPart = `
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

      const todayPart = `
        SELECT 
          CASE 
            WHEN DATEDIFF(DATE(updated_at), due_date) BETWEEN 1 AND 30 THEN '1-30'
            WHEN DATEDIFF(DATE(updated_at), due_date) BETWEEN 31 AND 60 THEN '31-60'
            WHEN DATEDIFF(DATE(updated_at), due_date) BETWEEN 61 AND 90 THEN '61-90'
            ELSE '>90'
          END as age_range,
          COUNT(*) as count,
          SUM(remaining) as amount
        FROM debts
        WHERE deleted_at IS NULL AND status != 'paid'
          AND DATE(updated_at) = DATE(?)
          AND DATEDIFF(DATE(updated_at), due_date) > 0
        GROUP BY age_range
      `;

      return { historyPart, todayPart };
    };

    const { historyPart, todayPart } = buildAgingUnionQuery();
    const params: any[] = [];
    let unionQuery = '';

    // Xử lý các ngày trong quá khứ từ debt_statistics
    if (fromDate < today) {
      const endDateForHistory =
        effectiveToDate < today
          ? effectiveToDate
          : new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000)
              .toISOString()
              .split('T')[0];

      params.push(fromDate, endDateForHistory);
      unionQuery = historyPart;
    }

    // Xử lý ngày hôm nay từ debts
    if (effectiveToDate >= today) {
      const todayVietnam = this.formatDateStringToVietnam(today);
      params.push(todayVietnam);

      if (unionQuery) {
        unionQuery += ' UNION ALL ' + todayPart;
      } else {
        unionQuery = todayPart;
      }
    }

    // Phase 1.3: Tối ưu hóa - Gộp kết quả trong database thay vì application layer
    const finalQuery = `
      SELECT 
        age_range,
        SUM(count) as count,
        SUM(amount) as amount
      FROM (${unionQuery}) as combined_aging
      GROUP BY age_range
      ORDER BY CASE age_range 
        WHEN '1-30' THEN 1 
        WHEN '31-60' THEN 2 
        WHEN '61-90' THEN 3 
        ELSE 4 
      END
    `;

    const results = await this.debtStatisticRepository.query(finalQuery, params);

    return results.map((item) => ({
      range: item.age_range,
      count: Number(item.count) || 0,
      amount: Number(item.amount) || 0,
    }));
  }

  // Daily aging buckets per date range, 4 buckets per day
  async getAgingDaily(fromDate: string, toDate: string, opts: { employeeCode?: string; customerCode?: string } = {}) {
    const today = this.getVietnamToday();
    
    // Nếu toDate là tương lai, chỉ tính đến ngày hiện tại
    const effectiveToDate = toDate > today ? today : toDate;
    
    const dates = this.generateDateRange(fromDate, effectiveToDate).filter((d) => new Date(d).getDay() !== 0); // skip Sunday
    const results: Array<{ date: string; range: string; count: number; amount: number }> = [];
    for (const D of dates) {
  if (D < today) {
        // Use exact snapshot for the requested date (match modal behavior)
        const filters: string[] = [
          "ds.status <> 'paid'",
          'ds.due_date IS NOT NULL',
          'DATEDIFF(ds.statistic_date, ds.due_date) > 0',
        ];
        const args: any[] = [];
        if (opts.employeeCode) { filters.push('ds.employee_code_raw = ?'); args.push(opts.employeeCode); }
        if (opts.customerCode) { filters.push('ds.customer_code = ?'); args.push(opts.customerCode); }
        const query = `
          SELECT
            CASE
              WHEN DATEDIFF(ds.statistic_date, ds.due_date) BETWEEN 1 AND 30 THEN '1-30'
              WHEN DATEDIFF(ds.statistic_date, ds.due_date) BETWEEN 31 AND 60 THEN '31-60'
              WHEN DATEDIFF(ds.statistic_date, ds.due_date) BETWEEN 61 AND 90 THEN '61-90'
              ELSE '>90'
            END AS bucket,
            COUNT(*) AS count,
            SUM(ds.remaining) AS amount
          FROM debt_statistics ds
          WHERE ds.statistic_date = ?
            AND ${filters.join(' AND ')}
          GROUP BY bucket`;
  const rows = await this.debtStatisticRepository.query(query, [D, ...args]);
  console.debug('[getAgingDaily] historical rows for', D, rows);
  for (const r of rows) results.push({ date: D, range: r.bucket, count: Number(r.count) || 0, amount: Number(r.amount) || 0 });
      } else {
        const where: string[] = [
          'd.deleted_at IS NULL',
          "d.status <> 'paid'",
          'd.due_date IS NOT NULL',
          'DATEDIFF(?, d.due_date) > 0',
          'DATE(d.updated_at) = DATE(?)', // Thêm filter theo ngày hiện tại
        ];
        const arr: any[] = [D, D]; // Thêm D cho filter DATE(d.updated_at) = DATE(?)
        if (opts.employeeCode) { where.push('d.employee_code_raw = ?'); arr.push(opts.employeeCode); }
        if (opts.customerCode) { where.push('dc.customer_code = ?'); arr.push(opts.customerCode); }
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
          GROUP BY bucket`;
  const rows = await this.debtRepository.query(query, [D, D, D, ...arr]);
  for (const r of rows) results.push({ date: D, range: r.bucket, count: Number(r.count) || 0, amount: Number(r.amount) || 0 });
      }
    }
    return results;
  }

  // Daily pay-later buckets per day using ranges config
  async getPayLaterDelayDaily(from: string, to: string, buckets: number[], options: { employeeCode?: string; customerCode?: string } = {}) {
    const today = this.getVietnamToday();
    
    // Nếu to là tương lai, chỉ tính đến ngày hiện tại
    const effectiveTo = to > today ? today : to;
    
    const dates = this.generateDateRange(from, effectiveTo).filter((d) => new Date(d).getDay() !== 0);
    const sorted = [...buckets].sort((a, b) => a - b);
    const ranges = [] as Array<{ label: string; min: number; max: number | null }>;
    let prev = 0;
    for (const b of sorted) { ranges.push({ label: `${prev + 1}-${b}`, min: prev + 1, max: b }); prev = b; }
    ranges.push({ label: `>${prev}`, min: prev + 1, max: null });
    const results: Array<{ date: string; range: string; count: number; amount: number }> = [];
    for (const D of dates) {
      if (D < today) {
        // Use exact snapshot for the requested date to match modal
        const whereClauses: string[] = [
          "ds.status <> 'paid'", 
          'ds.pay_later IS NOT NULL',
          'ds.statistic_date = ?'
        ];
        const params: any[] = [D];
        if (options.employeeCode) { whereClauses.push('ds.employee_code_raw = ?'); params.push(options.employeeCode); }
        if (options.customerCode) { whereClauses.push('ds.customer_code = ?'); params.push(options.customerCode); }
        // Use statistic_date in DATEDIFF like aging logic to avoid placeholder proliferation
        const parts = ranges.map((r) => {
          const cond = r.max == null ? `DATEDIFF(ds.statistic_date, ds.pay_later) >= ${r.min}` : `DATEDIFF(ds.statistic_date, ds.pay_later) BETWEEN ${r.min} AND ${r.max}`;
          return `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS cnt_${r.label.replace(/[^a-zA-Z0-9_]/g, '_')}, SUM(CASE WHEN ${cond} THEN ds.remaining ELSE 0 END) AS amt_${r.label.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        }).join(',');
        const query = `SELECT ${parts} FROM debt_statistics ds WHERE ${whereClauses.join(' AND ')}`;
        const row = (await this.debtStatisticRepository.query(query, params))[0] || {};
        for (const r of ranges) {
          const key = r.label.replace(/[^a-zA-Z0-9_]/g, '_');
          results.push({ date: D, range: r.label, count: Number(row[`cnt_${key}`]) || 0, amount: Number(row[`amt_${key}`]) || 0 });
        }
      } else if (D === today) {
        // Ngày hiện tại: Lấy từ debts (real-time)
        const where: string[] = [
          'd.deleted_at IS NULL',
          "d.status <> 'paid'",
          'd.pay_later IS NOT NULL',
          'DATE(d.updated_at) = DATE(?)', // Thêm filter theo ngày hiện tại
        ];
        const arr: any[] = [D]; // Chỉ cần một D cho filter DATE(d.updated_at) = DATE(?)
        if (options.employeeCode) { where.push('d.employee_code_raw = ?'); arr.push(options.employeeCode); }
        if (options.customerCode) { where.push('dc.customer_code = ?'); arr.push(options.customerCode); }
        // Use DATE(updated_at) in DATEDIFF like aging logic
        const parts = ranges.map((r) => {
          const cond = r.max == null ? `DATEDIFF(DATE(t.updated_at), t.pay_later) >= ${r.min}` : `DATEDIFF(DATE(t.updated_at), t.pay_later) BETWEEN ${r.min} AND ${r.max}`;
          return `SUM(CASE WHEN ${cond} THEN 1 ELSE 0 END) AS cnt_${r.label.replace(/[^a-zA-Z0-9_]/g, '_')}, SUM(CASE WHEN ${cond} THEN t.remaining ELSE 0 END) AS amt_${r.label.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        }).join(',');
        const query = `SELECT ${parts} FROM (
          SELECT d.* FROM debts d
          LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
          WHERE ${where.join(' AND ')}
        ) t`;
        const row = (await this.debtRepository.query(query, [...arr]))[0] || {};
        for (const r of ranges) {
          const key = r.label.replace(/[^a-zA-Z0-9_]/g, '_');
          results.push({ date: D, range: r.label, count: Number(row[`cnt_${key}`]) || 0, amount: Number(row[`amt_${key}`]) || 0 });
        }
      }
      // D > today: không làm gì, tự động trả về 0
    }
    return results;
  }

  // Daily contact responses per remind_status
  async getContactResponsesDaily(from: string, to: string, by: 'customer' | 'invoice' = 'customer', options: { employeeCode?: string; customerCode?: string } = {}) {
    // Keep Sunday filter but fix timezone issue
    const today = this.getVietnamToday();
    const dates = this.generateDateRange(from, to).filter((d) => new Date(d).getDay() !== 0);
    const results: Array<{ date: string; status: string; customers: number }> = [];
    for (const D of dates) {
      const selectDistinct = by === 'customer' ? 'COUNT(DISTINCT dc.customer_code)' : 'COUNT(*)';

      if (D < today) {
        // Past days: use events from debt_histories on that day
        // FIX: Use DATE(send_at) to reflect actual message send time
        const where = ["DATE(dh.send_at) = ?"] as string[];
        const arr: any[] = [D];
        if (options.employeeCode) { where.push('u.employee_code = ?'); arr.push(options.employeeCode); }
        if (options.customerCode) { where.push('dc.customer_code = ?'); arr.push(options.customerCode); }
        const query = `
          SELECT dh.remind_status as status, ${selectDistinct} as customers
          FROM debt_histories dh
          LEFT JOIN debt_logs dl ON dh.debt_log_id = dl.id
          LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
          LEFT JOIN users u ON dc.employee_id = u.id
          WHERE ${where.join(' AND ')}
          GROUP BY dh.remind_status
        `;
        const rows = await this.debtHistoriesRepository.query(query, arr);
        for (const r of rows) results.push({ date: D, status: r.status, customers: Number(r.customers) || 0 });
      } else if (D === today) {
        // Ngày hiện tại: Lấy từ debt_logs (real-time)
        const where = ["DATE(dl.send_at) = ?"] as string[];
        const arr: any[] = [D];
        if (options.employeeCode) { where.push('u.employee_code = ?'); arr.push(options.employeeCode); }
        if (options.customerCode) { where.push('dc.customer_code = ?'); arr.push(options.customerCode); }
        const query = `
          SELECT dl.remind_status as status, ${selectDistinct} as customers
          FROM debt_logs dl
          LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
          LEFT JOIN users u ON dc.employee_id = u.id
          WHERE ${where.join(' AND ')}
          GROUP BY dl.remind_status
        `;
        const rows = await this.debtLogsRepository.query(query, arr);
        for (const r of rows) results.push({ date: D, status: r.status, customers: Number(r.customers) || 0 });
      }
      // D > today: không làm gì, tự động trả về 0
    }
    return results;
  }

  // New as-of implementation per plan: single D date determines snapshot selection
  async getAgingAnalysisAsOf(params: { singleDate?: string; from?: string; to?: string; employeeCode?: string; customerCode?: string }) {
    const D = this.resolveAsOfDate(params);
    const today = this.getVietnamToday();

    if (D < today) {
      const filters: string[] = [
        "ds.status <> 'paid'",
        'ds.due_date IS NOT NULL',
        'DATEDIFF(ds.statistic_date, ds.due_date) > 0',
      ];
      const args: any[] = [];
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
            WHEN DATEDIFF(ds.statistic_date, ds.due_date) BETWEEN 1 AND 30 THEN '1-30'
            WHEN DATEDIFF(ds.statistic_date, ds.due_date) BETWEEN 31 AND 60 THEN '31-60'
            WHEN DATEDIFF(ds.statistic_date, ds.due_date) BETWEEN 61 AND 90 THEN '61-90'
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
      // Placeholders: 1 for latest.snap_date (<= ?), then ...args
      const rows = await this.debtStatisticRepository.query(query, [D, ...args]);
      return rows.map((r: any) => ({ range: r.bucket, count: Number(r.count) || 0, amount: Number(r.amount) || 0 }));
    } else {
      // Ngày hiện tại: Lấy từ debts (real-time) - BÌNH THƯỜNG
      const where: string[] = [
        'd.deleted_at IS NULL',
        "d.status <> 'paid'",
        'd.due_date IS NOT NULL',
        'DATEDIFF(DATE(d.updated_at), d.due_date) > 0',
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
      const query = `
        SELECT
          CASE
            WHEN DATEDIFF(DATE(d.updated_at), d.due_date) BETWEEN 1 AND 30 THEN '1-30'
            WHEN DATEDIFF(DATE(d.updated_at), d.due_date) BETWEEN 31 AND 60 THEN '31-60'
            WHEN DATEDIFF(DATE(d.updated_at), d.due_date) BETWEEN 61 AND 90 THEN '61-90'
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
      // Placeholders: provided in ...arr
      const rows = await this.debtRepository.query(query, [...arr]);
      return rows.map((r: any) => ({ range: r.bucket, count: Number(r.count) || 0, amount: Number(r.amount) || 0 }));
    }
  }

  // Phase 1.4: Tối ưu hóa - Sử dụng dynamic bucket generation và loại bỏ nested loops
  async getPayLaterDelay(
    fromDate: string,
    toDate: string,
    buckets: number[],
    options: { employeeCode?: string; customerCode?: string } = {},
  ) {
    const today = this.getVietnamToday();
    
    // Nếu toDate là tương lai, chỉ tính đến ngày hiện tại
    const effectiveToDate = toDate > today ? today : toDate;
    
    // Phase 1.4: Tối ưu hóa - Dynamic bucket generation
    const sortedBuckets = [...buckets].sort((a, b) => a - b);
    const ranges: Array<{ label: string; min: number; max: number | null }> = [];
    let previous = 0;
    for (const b of sortedBuckets) {
      ranges.push({ label: `${previous + 1}-${b}`, min: previous + 1, max: b });
      previous = b;
    }
    ranges.push({ label: `>${previous}`, min: previous + 1, max: null });

    // Phase 1.4: Tối ưu hóa - Gộp logic xử lý historical và current data
    const buildPayLaterUnionQuery = () => {
      const historyPart = `
        SELECT 
          CASE 
            ${ranges.map(r => {
              const cond = r.max === null 
                ? `WHEN DATEDIFF(statistic_date, pay_later) >= ${r.min} THEN '${r.label}'`
                : `WHEN DATEDIFF(statistic_date, pay_later) BETWEEN ${r.min} AND ${r.max} THEN '${r.label}'`;
              return cond;
            }).join(' ')}
            ELSE NULL
          END as bucket,
          COUNT(*) as count,
          SUM(remaining) as amount
        FROM debt_statistics
        WHERE statistic_date >= ? AND statistic_date <= ? 
          AND status <> 'paid' 
          AND pay_later IS NOT NULL
      `;

      const todayPart = `
        SELECT 
          CASE 
            ${ranges.map(r => {
              const cond = r.max === null 
                ? `WHEN DATEDIFF(DATE(updated_at), pay_later) >= ${r.min} THEN '${r.label}'`
                : `WHEN DATEDIFF(DATE(updated_at), pay_later) BETWEEN ${r.min} AND ${r.max} THEN '${r.label}'`;
              return cond;
            }).join(' ')}
            ELSE NULL
          END as bucket,
          COUNT(*) as count,
          SUM(remaining) as amount
        FROM debts
        WHERE deleted_at IS NULL 
          AND status <> 'paid' 
          AND pay_later IS NOT NULL
          AND DATE(updated_at) = DATE(?)
      `;

      return { historyPart, todayPart };
    };

    const { historyPart, todayPart } = buildPayLaterUnionQuery();
    const params: any[] = [];
    let unionQuery = '';

    // Xử lý các ngày trong quá khứ từ debt_statistics
    if (fromDate < today) {
      const endHistory =
        effectiveToDate < today
          ? effectiveToDate
          : new Date(new Date(today).getTime() - 24 * 60 * 60 * 1000)
              .toISOString()
              .split('T')[0];

      let historyQuery = historyPart;
      params.push(fromDate, endHistory);
      
      if (options.employeeCode) {
        historyQuery += ` AND employee_code_raw = ?`;
        params.push(options.employeeCode);
      }
      if (options.customerCode) {
        historyQuery += ` AND customer_code = ?`;
        params.push(options.customerCode);
      }

      historyQuery += ` GROUP BY bucket`;
      unionQuery = historyQuery;
    }

    // Xử lý ngày hôm nay từ debts
    if (effectiveToDate >= today) {
      const todayVietnam = this.formatDateStringToVietnam(today);
      let todayQuery = todayPart;
      params.push(todayVietnam);
      
      if (options.employeeCode) {
        todayQuery += ` AND employee_code_raw = ?`;
        params.push(options.employeeCode);
      }
      if (options.customerCode) {
        todayQuery += ` AND customer_code = ?`;
        params.push(options.customerCode);
      }

      todayQuery += ` GROUP BY bucket`;

      if (unionQuery) {
        unionQuery += ' UNION ALL ' + todayQuery;
      } else {
        unionQuery = todayQuery;
      }
    }

    // Phase 1.4: Tối ưu hóa - Gộp kết quả trong database thay vì application layer
    const finalQuery = `
      SELECT 
        bucket as range,
        SUM(count) as count,
        SUM(amount) as amount
      FROM (${unionQuery}) as combined_pay_later
      WHERE bucket IS NOT NULL
      GROUP BY bucket
      ORDER BY CASE bucket 
        ${ranges.map((r, idx) => `WHEN '${r.label}' THEN ${idx + 1}`).join(' ')}
        ELSE 999 
      END
    `;

    const results = await this.debtStatisticRepository.query(finalQuery, params);

    return results.map((item) => ({
      range: item.range,
      count: Number(item.count) || 0,
      amount: Number(item.amount) || 0,
    }));
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
  // Use statistic_date like aging logic so case expressions reference snapshot date
  const caseExpr = buildCase('DATEDIFF(ds.statistic_date, ds.pay_later)');
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
  // No extra D placeholders needed because caseExpr uses ds.statistic_date
  const rows = await this.debtStatisticRepository.query(query, [D, ...arr]);
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
  // Use DATE(updated_at) like aging logic for today's calculation
  const caseExpr = buildCase('DATEDIFF(DATE(d.updated_at), d.pay_later)');
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
      // No extra D placeholders needed because caseExpr uses DATE(d.updated_at)
      const rows = await this.debtRepository.query(query, [...arr]);
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
    
    // Nếu toDate là tương lai, chỉ tính đến ngày hiện tại
    const effectiveToDate = toDate > today ? today : toDate;
    
    const resultsMap = new Map<string, { status: string; customers: number }>();

    const addCount = (status: string, count: number) => {
      const key = status || 'Unknown';
      const existing = resultsMap.get(key) || { status: key, customers: 0 };
      existing.customers += count;
      resultsMap.set(key, existing);
    };

    const mode = options.mode || 'events';

    // Mode events: đếm sự kiện trong khoảng [from, to] thuần theo debt_histories
    if (mode === 'events') {
      const whereClauses = [
        "DATE(dh.created_at) >= ? AND DATE(dh.created_at) <= ?",
      ];
      const params: any[] = [fromDate, effectiveToDate];
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
        "DATE(dh.created_at) >= ?",
        "DATE(dh.created_at) <= ?",
        'dh.remind_status = ?',
      ];
      const arr: any[] = [from, to, responseStatus];
      if (employeeCode) { where.push('u.employee_code = ?'); arr.push(employeeCode); }
      if (customerCode) { where.push('dc.customer_code = ?'); arr.push(customerCode); }

      const dataQuery = `
        SELECT 
          dc.customer_code, 
          dc.customer_name, 
          u.employee_code as employee_code_raw, 
          MAX(dh.created_at) as latest_time,
          MAX(dh.send_at) as send_at,
          MAX(dh.first_remind_at) as first_remind_at,
          MAX(dh.second_remind_at) as second_remind_at
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
        "DATE(dh.created_at) = ?",
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
        SELECT 
          dc.customer_code, 
          dc.customer_name, 
          u.employee_code as employee_code_raw, 
          MAX(dh.created_at) as latest_time,
          MAX(dh.send_at) as send_at,
          MAX(dh.first_remind_at) as first_remind_at,
          MAX(dh.second_remind_at) as second_remind_at
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
      // Format today to Vietnam timezone for MySQL query (optimized for index)
      const todayVietnam = this.formatDateStringToVietnam(today);
      const where: string[] = [
        'DATE(dl.updated_at) = DATE(?)',
        'dl.remind_status = ?'
      ];
      const arr: any[] = [todayVietnam, responseStatus];
      if (employeeCode) {
        where.push('u.employee_code = ?');
        arr.push(employeeCode);
      }
      if (customerCode) {
        where.push('dc.customer_code = ?');
        arr.push(customerCode);
      }
      const dataQuery = `
        SELECT 
          dc.customer_code, 
          dc.customer_name, 
          u.employee_code as employee_code_raw, 
          MAX(dl.updated_at) as latest_time,
          MAX(dl.send_at) as send_at,
          MAX(dl.first_remind_at) as first_remind_at,
          MAX(dl.second_remind_at) as second_remind_at
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
    const today = this.getVietnamToday();
    
    // Nếu toDate là tương lai, chỉ tính đến ngày hiện tại
    const effectiveToDate = toDate > today ? today : toDate;
    
    const results: any[] = [];

    // Lấy dữ liệu từ debt_statistics cho các ngày trong quá khứ
    if (fromDate < today) {
      const endDateForHistory =
        effectiveToDate < today
          ? effectiveToDate
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

    // BỎ FALLBACK: Không lấy dữ liệu realtime từ debts nữa
    // Chỉ lấy từ debt_statistics để đảm bảo tính nhất quán

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

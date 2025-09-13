import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DebtStatistic } from '../debt_statistics/debt_statistic.entity';

@Injectable()
export class DebtStatisticsCronjobService {
  private readonly logger = new Logger(DebtStatisticsCronjobService.name);

  constructor(
    @InjectRepository(DebtStatistic)
    private debtStatisticRepo: Repository<DebtStatistic>,
  ) {
    this.logger.log(
      '🎯 [DebtStatisticsCronjobService] Service đã được khởi tạo - Cronjob debt statistics sẽ chạy lúc 23h hàng ngày',
    );
  }

  @Cron(process.env.CRON_DEBT_STATISTICS_TIME || '0 23 * * *')
  async handleDebtStatisticsCron() {
    const executionStartTime = new Date();
    
    // Sử dụng timezone Việt Nam (UTC+7) 
    const today = new Date();
    const vietnamTime = new Date(today.getTime() + 7 * 60 * 60 * 1000);
    const todayStr = vietnamTime.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    const vietnamDate = new Date(todayStr);

    this.logger.log('=== BẮT ĐẦU DEBT STATISTICS CRONJOB ===');
    this.logger.log(`🔄 [Debt Statistics Cron] Thực hiện cho ngày: ${todayStr}`);
    this.logger.log(`🕐 Thời gian bắt đầu: ${this.formatDateTime(executionStartTime)}`);

    try {
      // Kiểm tra đã có data cho ngày hôm nay chưa
      const existingCount = await this.debtStatisticRepo.count({
        where: { statistic_date: vietnamDate },
      });

      if (existingCount > 0) {
        this.logger.log(`⚠️ [Debt Statistics Cron] Đã có ${existingCount} bản ghi cho ngày ${todayStr}, bỏ qua`);
        return;
      }

      // Insert dữ liệu clean sẵn - không trùng lặp từ đầu
      const insertedCount = await this.insertCleanDebtStatistics(vietnamDate, todayStr);

      const executionEndTime = new Date();
      const executionTime = executionEndTime.getTime() - executionStartTime.getTime();

      this.logger.log('=== KẾT QUẢ DEBT STATISTICS CRONJOB ===');
      this.logger.log(`✅ Đã insert: ${insertedCount} bản ghi clean cho ngày ${todayStr}`);
      this.logger.log(`⏱️ Thời gian thực hiện: ${executionTime}ms`);
      this.logger.log(`🕐 Hoàn thành lúc: ${this.formatDateTime(executionEndTime)}`);
      this.logger.log('=== KẾT THÚC DEBT STATISTICS CRONJOB ===');

    } catch (error) {
      this.logger.error('❌ [Debt Statistics Cron] Lỗi trong quá trình thực hiện:', error.stack);
      throw error;
    }
  }

  /**
   * Insert dữ liệu clean theo batch - loại bỏ duplicate ngay trong query
   */
  private async insertCleanDebtStatistics(vietnamDate: Date, todayStr: string): Promise<number> {
    this.logger.log(`📥 [Insert Clean] Bắt đầu insert dữ liệu clean cho ngày ${todayStr}`);

    try {
      // Bước 1: Đếm tổng số records cần insert
      const countQuery = `
        SELECT COUNT(DISTINCT d.id) as total
        FROM debts d
        LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
        WHERE d.deleted_at IS NULL
        AND DATE(d.updated_at) = DATE(?)
      `;
      
      const countResult = await this.debtStatisticRepo.query(countQuery, [vietnamDate]);
      const totalRecords = countResult[0]?.total || 0;

      this.logger.log(`📊 [Insert Clean] Tổng số records cần insert: ${totalRecords}`);

      if (totalRecords === 0) {
        this.logger.log(`⚠️ [Insert Clean] Không có debt nào được update trong ngày ${todayStr}`);
        return 0;
      }

      // Bước 2: Quyết định insert batch hay single
      const BATCH_SIZE = 1000;
      if (totalRecords <= BATCH_SIZE) {
        // Insert single nếu ít hơn threshold
        return await this.insertSingleBatch(vietnamDate, todayStr);
      } else {
        // Insert theo batch nếu nhiều hơn threshold
        return await this.insertMultipleBatches(vietnamDate, todayStr, BATCH_SIZE, totalRecords);
      }

    } catch (error) {
      this.logger.error(`❌ [Insert Clean] Lỗi khi insert dữ liệu clean:`, error.message);
      throw error;
    }
  }

  /**
   * Insert single batch (dưới 1000 records)
   */
  private async insertSingleBatch(vietnamDate: Date, todayStr: string): Promise<number> {
    this.logger.log(`📥 [Single Insert] Insert tất cả records trong 1 lần`);

    const query = `
      INSERT INTO debt_statistics (
        statistic_date, customer_raw_code, invoice_code, bill_code,
        total_amount, remaining, issue_date, due_date, pay_later,
        status, sale_id, sale_name_raw, employee_code_raw,
        debt_config_id, customer_code, customer_name, note,
        is_notified, original_created_at, original_updated_at, original_debt_id
      )
      SELECT DISTINCT
        ? as statistic_date,
        d.customer_raw_code, d.invoice_code, d.bill_code,
        d.total_amount, d.remaining, d.issue_date, d.due_date, d.pay_later,
        d.status, d.sale_id, d.sale_name_raw, d.employee_code_raw,
        d.debt_config_id, dc.customer_code, dc.customer_name, d.note,
        d.is_notified, d.created_at, d.updated_at, d.id
      FROM debts d
      LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
      WHERE d.deleted_at IS NULL
      AND DATE(d.updated_at) = DATE(?)
      GROUP BY 
        d.customer_raw_code, d.invoice_code, d.bill_code,
        d.total_amount, d.remaining, d.issue_date, d.due_date, d.pay_later,
        d.status, d.sale_id, d.sale_name_raw, d.employee_code_raw,
        d.debt_config_id, dc.customer_code, dc.customer_name, d.note,
        d.is_notified, d.created_at, d.updated_at, d.id
      ORDER BY d.id ASC
    `;

    const result = await this.debtStatisticRepo.query(query, [vietnamDate, vietnamDate]);
    const insertedCount = result.affectedRows || 0;

    this.logger.log(`✅ [Single Insert] Đã insert ${insertedCount} bản ghi clean`);
    return insertedCount;
  }

  /**
   * Insert multiple batches (trên 2000 records)
   */
  private async insertMultipleBatches(vietnamDate: Date, todayStr: string, batchSize: number, totalRecords: number): Promise<number> {
    this.logger.log(`📦 [Batch Insert] Insert theo batch - Size: ${batchSize}, Total: ${totalRecords}`);

    let totalInserted = 0;
    let offset = 0;
    let batchNumber = 1;

    while (offset < totalRecords) {
      this.logger.log(`🔄 [Batch Insert] Đang xử lý batch ${batchNumber} (offset: ${offset}, limit: ${batchSize})`);

      try {
        const batchQuery = `
          INSERT INTO debt_statistics (
            statistic_date, customer_raw_code, invoice_code, bill_code,
            total_amount, remaining, issue_date, due_date, pay_later,
            status, sale_id, sale_name_raw, employee_code_raw,
            debt_config_id, customer_code, customer_name, note,
            is_notified, original_created_at, original_updated_at, original_debt_id
          )
          SELECT DISTINCT
            ? as statistic_date,
            d.customer_raw_code, d.invoice_code, d.bill_code,
            d.total_amount, d.remaining, d.issue_date, d.due_date, d.pay_later,
            d.status, d.sale_id, d.sale_name_raw, d.employee_code_raw,
            d.debt_config_id, dc.customer_code, dc.customer_name, d.note,
            d.is_notified, d.created_at, d.updated_at, d.id
          FROM debts d
          LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
          WHERE d.deleted_at IS NULL
          AND DATE(d.updated_at) = DATE(?)
          GROUP BY 
            d.customer_raw_code, d.invoice_code, d.bill_code,
            d.total_amount, d.remaining, d.issue_date, d.due_date, d.pay_later,
            d.status, d.sale_id, d.sale_name_raw, d.employee_code_raw,
            d.debt_config_id, dc.customer_code, dc.customer_name, d.note,
            d.is_notified, d.created_at, d.updated_at, d.id
          ORDER BY d.id ASC
          LIMIT ? OFFSET ?
        `;

        const result = await this.debtStatisticRepo.query(batchQuery, [
          vietnamDate, vietnamDate, batchSize, offset
        ]);

        const batchInserted = result.affectedRows || 0;
        totalInserted += batchInserted;

        this.logger.log(`✅ [Batch Insert] Batch ${batchNumber}: Đã insert ${batchInserted} records (Total: ${totalInserted})`);

        // Nếu batch này ít hơn batchSize thì đã hết data
        if (batchInserted < batchSize) {
          this.logger.log(`📦 [Batch Insert] Batch ${batchNumber} là batch cuối cùng`);
          break;
        }

        offset += batchSize;
        batchNumber++;

        // Delay nhỏ giữa các batch để tránh overload
        await this.delay(200); // 200ms delay

      } catch (error) {
        this.logger.error(`❌ [Batch Insert] Lỗi trong batch ${batchNumber}:`, error.message);
        throw error;
      }
    }

    this.logger.log(`🎯 [Batch Insert] Hoàn thành: ${totalInserted} records trong ${batchNumber} batch(es)`);
    return totalInserted;
  }

  /**
   * Utility function để delay giữa các batch
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Format datetime để hiển thị rõ ràng
   */
  private formatDateTime(date: Date): string {
    return date.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
}
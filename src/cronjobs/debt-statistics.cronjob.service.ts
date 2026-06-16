import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DebtStatistic } from '../debt_statistics/debt_statistic.entity';
import { WinstonLogger } from '../common/winston.logger';

@Injectable()
export class DebtStatisticsCronjobService {
  private readonly logger = new WinstonLogger(
    DebtStatisticsCronjobService.name,
  );

  constructor(
    @InjectRepository(DebtStatistic)
    private debtStatisticRepo: Repository<DebtStatistic>,
  ) {
    this.logger.log(
      '🎯 [DebtStatisticsCronjobService] Service đã được khởi tạo - Insert cronjob sẽ chạy lúc 22:30, Cleanup cronjob sẽ chạy lúc 23:15 hàng ngày',
    );
  }

  @Cron(process.env.CRON_DEBT_STATISTICS_TIME || '30 22 * * *')
  async handleDebtStatisticsCron() {
    const executionStartTime = new Date();
    // Xác định ngày tại VN (UTC+7) và phạm vi thời gian [start, end) theo UTC để truy vấn
    const {
      dayStr: todayStr,
      startUtcStr,
      endUtcStr,
    } = this.getVietnamDayRangeStrings();

    this.logger.log('=== BẮT ĐẦU DEBT STATISTICS CRONJOB ===');
    this.logger.log(
      `🔄 [Debt Statistics Cron] Thực hiện cho ngày: ${todayStr}`,
    );
    this.logger.log(
      `🕐 Thời gian bắt đầu: ${this.formatDateTime(executionStartTime)}`,
    );

    try {
      // Bảo vệ chạy trùng bằng MySQL advisory lock theo ngày
      const lockKey = `debt_stats:${todayStr}`;
      const lockRes = await this.debtStatisticRepo.query(
        'SELECT GET_LOCK(?, 0) AS got',
        [lockKey],
      );
      const gotLock = Number(lockRes?.[0]?.got) === 1;
      if (!gotLock) {
        this.logger.warn(
          `⛔ [Debt Statistics Cron] Bỏ qua vì không lấy được lock cho key ${lockKey} (đang có tác vụ khác chạy)`,
        );
        return;
      }

      // Đảm bảo unique index để idempotent theo (statistic_date, original_debt_id)
      await this.ensureUniqueIndex();

      // Kiểm tra đã có data cho ngày hôm nay chưa
      const existing = await this.debtStatisticRepo.query(
        'SELECT COUNT(*) AS c FROM debt_statistics WHERE statistic_date = ?',
        [todayStr],
      );
      const existingCount = Number(existing?.[0]?.c || 0);

      if (existingCount > 0) {
        this.logger.log(
          `⚠️ [Debt Statistics Cron] Đã có ${existingCount} bản ghi cho ngày ${todayStr}, bỏ qua`,
        );
        // Release lock trước khi thoát
        await this.debtStatisticRepo.query('SELECT RELEASE_LOCK(?)', [lockKey]);
        return;
      }

      // Insert dữ liệu clean sẵn - không trùng lặp từ đầu
      const insertedCount = await this.insertCleanDebtStatistics(
        todayStr,
        startUtcStr,
        endUtcStr,
      );

      const executionEndTime = new Date();
      const executionTime =
        executionEndTime.getTime() - executionStartTime.getTime();

      this.logger.log('=== KẾT QUẢ DEBT STATISTICS CRONJOB ===');
      this.logger.log(
        `✅ Đã insert: ${insertedCount} bản ghi clean cho ngày ${todayStr}`,
      );
      this.logger.log(`⏱️ Thời gian thực hiện: ${executionTime}ms`);
      this.logger.log(
        `🕐 Hoàn thành lúc: ${this.formatDateTime(executionEndTime)}`,
      );
      this.logger.log('=== KẾT THÚC DEBT STATISTICS CRONJOB ===');
    } catch (error) {
      this.logger.error(
        '❌ [Debt Statistics Cron] Lỗi trong quá trình thực hiện:',
        error.stack,
      );
      throw error;
    } finally {
      // Luôn cố gắng release lock (nếu có)
      try {
        const { dayStr } = this.getVietnamDayRangeStrings();
        const lockKey = `debt_stats:${dayStr}`;
        await this.debtStatisticRepo.query('SELECT RELEASE_LOCK(?)', [lockKey]);
      } catch (e) {
        // ignore
      }
    }
  }

  @Cron(process.env.CRON_DEBT_STATISTICS_CLEANUP_TIME || '15 23 * * *')
  async handleDebtStatisticsCleanupCron() {
    const executionStartTime = new Date();
    const { dayStr: todayStr } = this.getVietnamDayRangeStrings();

    this.logger.log('=== BẮT ĐẦU DEBT STATISTICS CLEANUP CRONJOB ===');
    this.logger.log(
      `🗑️ [Debt Cleanup Cron] Thực hiện cleanup cho ngày: ${todayStr}`,
    );
    this.logger.log(
      `🕐 Thời gian bắt đầu: ${this.formatDateTime(executionStartTime)}`,
    );

    try {
      // Bảo vệ chạy trùng bằng MySQL advisory lock riêng cho cleanup
      const lockKey = `debt_cleanup:${todayStr}`;
      const lockRes = await this.debtStatisticRepo.query(
        'SELECT GET_LOCK(?, 0) AS got',
        [lockKey],
      );
      const gotLock = Number(lockRes?.[0]?.got) === 1;
      if (!gotLock) {
        this.logger.warn(
          `⛔ [Debt Cleanup Cron] Bỏ qua vì không lấy được lock cho key ${lockKey} (đang có tác vụ khác chạy)`,
        );
        return;
      }

      // Chạy cleanup
      const deletedCount = await this.cleanupOldRecords(todayStr);

      const executionEndTime = new Date();
      const executionTime =
        executionEndTime.getTime() - executionStartTime.getTime();

      this.logger.log('=== KẾT QUẢ DEBT STATISTICS CLEANUP CRONJOB ===');
      this.logger.log(
        `🗑️ Đã cleanup: ${deletedCount} bản ghi cũ cho ngày ${todayStr}`,
      );
      this.logger.log(`⏱️ Thời gian thực hiện: ${executionTime}ms`);
      this.logger.log(
        `🕐 Hoàn thành lúc: ${this.formatDateTime(executionEndTime)}`,
      );
      this.logger.log('=== KẾT THÚC DEBT STATISTICS CLEANUP CRONJOB ===');
    } catch (error) {
      this.logger.error(
        '❌ [Debt Cleanup Cron] Lỗi trong quá trình thực hiện:',
        error.stack,
      );
      throw error;
    } finally {
      // Release lock
      try {
        const { dayStr } = this.getVietnamDayRangeStrings();
        const lockKey = `debt_cleanup:${dayStr}`;
        await this.debtStatisticRepo.query('SELECT RELEASE_LOCK(?)', [lockKey]);
      } catch (e) {
        // ignore
      }
    }
  }

  /**
   * Insert dữ liệu clean theo batch - loại bỏ duplicate bằng unique index + INSERT IGNORE
   */
  private async insertCleanDebtStatistics(
    todayStr: string,
    startUtcStr: string,
    endUtcStr: string,
  ): Promise<number> {
    this.logger.log(
      `📥 [Insert Clean] Bắt đầu insert dữ liệu clean cho ngày ${todayStr}`,
    );

    try {
      // Bước 1: Đếm tổng số records cần insert
      const countQuery = `
        SELECT COUNT(d.id) as total
        FROM debts d
        LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
        WHERE d.deleted_at IS NULL
        AND d.updated_at >= ? AND d.updated_at < ?
      `;
      const countResult = await this.debtStatisticRepo.query(countQuery, [
        startUtcStr,
        endUtcStr,
      ]);
      const totalRecords = countResult[0]?.total || 0;

      this.logger.log(
        `📊 [Insert Clean] Tổng số records cần insert: ${totalRecords}`,
      );

      if (totalRecords === 0) {
        this.logger.log(
          `⚠️ [Insert Clean] Không có debt nào được update trong ngày ${todayStr}`,
        );
        return 0;
      }

      // Bước 2: Quyết định insert batch hay single
      const BATCH_SIZE = 1000;
      if (totalRecords <= BATCH_SIZE) {
        // Insert single nếu ít hơn threshold
        return await this.insertSingleBatch(todayStr, startUtcStr, endUtcStr);
      } else {
        // Insert theo batch nếu nhiều hơn threshold
        return await this.insertMultipleBatches(
          todayStr,
          startUtcStr,
          endUtcStr,
          BATCH_SIZE,
          totalRecords,
        );
      }
    } catch (error) {
      this.logger.error(
        `❌ [Insert Clean] Lỗi khi insert dữ liệu clean:`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * Insert single batch (dưới 1000 records)
   */
  private async insertSingleBatch(
    todayStr: string,
    startUtcStr: string,
    endUtcStr: string,
  ): Promise<number> {
    this.logger.log(`📥 [Single Insert] Insert tất cả records trong 1 lần`);

    const query = `
      INSERT IGNORE INTO debt_statistics (
        statistic_date, customer_raw_code, invoice_code, bill_code,
        total_amount, remaining, issue_date, due_date, pay_later,
        status, sale_id, sale_name_raw, employee_code_raw,
        debt_config_id, customer_code, customer_name, note,
        is_notified, original_created_at, original_updated_at, original_debt_id
      )
      SELECT
        ? AS statistic_date,
        d.customer_raw_code, d.invoice_code, d.bill_code,
        d.total_amount, d.remaining, d.issue_date, d.due_date, d.pay_later,
        d.status, d.sale_id, d.sale_name_raw, d.employee_code_raw,
        d.debt_config_id, dc.customer_code, dc.customer_name, d.note,
        d.is_notified, d.created_at, d.updated_at, d.id
      FROM debts d
      LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
      WHERE d.deleted_at IS NULL
      AND d.updated_at >= ? AND d.updated_at < ?
      ORDER BY d.id ASC
    `;

    const result: any = await this.debtStatisticRepo.query(query, [
      todayStr,
      startUtcStr,
      endUtcStr,
    ]);
    const insertedCount = Number(result?.affectedRows || 0);

    this.logger.log(
      `✅ [Single Insert] Đã insert ${insertedCount} bản ghi clean`,
    );
    return insertedCount;
  }

  /**
   * Insert multiple batches (trên 2000 records)
   */
  private async insertMultipleBatches(
    todayStr: string,
    startUtcStr: string,
    endUtcStr: string,
    batchSize: number,
    totalRecords: number,
  ): Promise<number> {
    this.logger.log(
      `📦 [Batch Insert] Insert theo batch - Size: ${batchSize}, Total: ${totalRecords}`,
    );

    let totalInserted = 0;
    let offset = 0;
    let batchNumber = 1;

    while (offset < totalRecords) {
      this.logger.log(
        `🔄 [Batch Insert] Đang xử lý batch ${batchNumber} (offset: ${offset}, limit: ${batchSize})`,
      );

      try {
        const batchQuery = `
          INSERT IGNORE INTO debt_statistics (
            statistic_date, customer_raw_code, invoice_code, bill_code,
            total_amount, remaining, issue_date, due_date, pay_later,
            status, sale_id, sale_name_raw, employee_code_raw,
            debt_config_id, customer_code, customer_name, note,
            is_notified, original_created_at, original_updated_at, original_debt_id
          )
          SELECT
            ? AS statistic_date,
            d.customer_raw_code, d.invoice_code, d.bill_code,
            d.total_amount, d.remaining, d.issue_date, d.due_date, d.pay_later,
            d.status, d.sale_id, d.sale_name_raw, d.employee_code_raw,
            d.debt_config_id, dc.customer_code, dc.customer_name, d.note,
            d.is_notified, d.created_at, d.updated_at, d.id
          FROM debts d
          LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
          WHERE d.deleted_at IS NULL
          AND d.updated_at >= ? AND d.updated_at < ?
          ORDER BY d.id ASC
          LIMIT ? OFFSET ?
        `;

        const result: any = await this.debtStatisticRepo.query(batchQuery, [
          todayStr,
          startUtcStr,
          endUtcStr,
          batchSize,
          offset,
        ]);

        const batchInserted = Number(result?.affectedRows || 0);
        totalInserted += batchInserted;

        this.logger.log(
          `✅ [Batch Insert] Batch ${batchNumber}: Đã insert ${batchInserted} records (Total: ${totalInserted})`,
        );

        // Nếu batch này ít hơn batchSize thì đã hết data
        if (batchInserted < batchSize) {
          this.logger.log(
            `📦 [Batch Insert] Batch ${batchNumber} là batch cuối cùng`,
          );
          break;
        }

        offset += batchSize;
        batchNumber++;

        // Delay nhỏ giữa các batch để tránh overload
        await this.delay(200); // 200ms delay
      } catch (error) {
        this.logger.error(
          `❌ [Batch Insert] Lỗi trong batch ${batchNumber}:`,
          error.message,
        );
        throw error;
      }
    }

    this.logger.log(
      `🎯 [Batch Insert] Hoàn thành: ${totalInserted} records trong ${batchNumber} batch(es)`,
    );
    return totalInserted;
  }

  /**
   * Utility function để delay giữa các batch
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  /**
   * Trả về ngày (YYYY-MM-DD) tại VN và cặp thời điểm UTC dạng chuỗi 'YYYY-MM-DD HH:mm:ss'
   * tương ứng với [00:00:00, 24:00:00) theo giờ VN.
   */
  private getVietnamDayRangeStrings(): {
    dayStr: string;
    startUtcStr: string;
    endUtcStr: string;
  } {
    // Lấy thời điểm hiện tại rồi quy đổi sang giờ VN để lấy dayStr
    const now = new Date();
    const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000); // UTC+7 (VN không có DST)
    const [dayStr] = vnNow.toISOString().split('T'); // YYYY-MM-DD theo ngữ cảnh VN đã offset

    // Tạo mốc thời gian VN
    const startVn = new Date(`${dayStr}T00:00:00+07:00`);
    // end là 00:00 của ngày kế tiếp VN
    const endVn = new Date(
      new Date(`${dayStr}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000,
    );

    // Chuyển sang UTC string MySQL (YYYY-MM-DD HH:mm:ss)
    const startUtcStr = this.toMysqlDateTime(startVn);
    const endUtcStr = this.toMysqlDateTime(endVn);

    return { dayStr, startUtcStr, endUtcStr };
  }

  private toMysqlDateTime(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const yyyy = d.getUTCFullYear();
    const mm = pad(d.getUTCMonth() + 1);
    const dd = pad(d.getUTCDate());
    const HH = pad(d.getUTCHours());
    const MM = pad(d.getUTCMinutes());
    const SS = pad(d.getUTCSeconds());
    return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
  }

  /**
   * Cleanup các bản ghi cũ không còn phù hợp sau khi insert
   * Chạy câu lệnh DELETE với win0 = ngày hiện tại của cronjob
   */
  private async cleanupOldRecords(todayStr: string): Promise<number> {
    this.logger.log(
      `🗑️ [Cleanup] Bắt đầu dọn dẹp các bản ghi cũ cho ngày ${todayStr}`,
    );

    try {
      // Sử dụng todayStr làm win0 (ngày hiện tại của cronjob)
      const win0 = todayStr; // YYYY-MM-DD format

      this.logger.log(`📅 [Cleanup] Sử dụng win0 = ${win0}`);

      // Đếm số bản ghi sẽ bị xóa trước khi thực hiện
      const countQuery = `
        SELECT COUNT(*) AS total
        FROM \`debt_statistics\`
        WHERE created_at >= ?
          AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
          AND original_updated_at < ?
          AND NOT (updated_at >= DATE_ADD(?, INTERVAL 1 DAY) AND updated_at < DATE_ADD(?, INTERVAL 2 DAY))
      `;

      const countResult = await this.debtStatisticRepo.query(countQuery, [
        win0,
        win0,
        win0,
        win0,
        win0,
      ]);
      const totalToDelete = countResult[0]?.total || 0;

      this.logger.log(`🔢 [Cleanup] Số bản ghi sẽ bị xóa: ${totalToDelete}`);

      if (totalToDelete === 0) {
        this.logger.log(
          `⚠️ [Cleanup] Không có bản ghi nào cần cleanup cho ngày ${todayStr}`,
        );
        return 0;
      }

      // Cleanup theo batch 1000 records mỗi lần
      const BATCH_SIZE = 1000;
      let totalDeleted = 0;
      let batchNumber = 1;

      while (totalDeleted < totalToDelete) {
        this.logger.log(
          `🔄 [Cleanup] Đang xử lý batch ${batchNumber} (đã xóa: ${totalDeleted}/${totalToDelete})`,
        );

        try {
          const deleteQuery = `
            DELETE FROM \`debt_statistics\`
            WHERE id IN (
              SELECT id FROM (
                SELECT id
                FROM \`debt_statistics\`
                WHERE created_at >= ?
                  AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
                  AND original_updated_at < ?
                  AND NOT (updated_at >= DATE_ADD(?, INTERVAL 1 DAY) AND updated_at < DATE_ADD(?, INTERVAL 2 DAY))
                LIMIT ?
              ) AS t
            )
          `;

          const result: any = await this.debtStatisticRepo.query(deleteQuery, [
            win0,
            win0,
            win0,
            win0,
            win0,
            BATCH_SIZE,
          ]);
          const batchDeleted = Number(result?.affectedRows || 0);
          totalDeleted += batchDeleted;

          this.logger.log(
            `✅ [Cleanup] Batch ${batchNumber}: Đã xóa ${batchDeleted} records (Total: ${totalDeleted})`,
          );

          // Nếu batch này xóa ít hơn BATCH_SIZE thì đã hết data hoặc gặp vấn đề
          if (batchDeleted < BATCH_SIZE) {
            this.logger.log(
              `📦 [Cleanup] Batch ${batchNumber} là batch cuối cùng hoặc không còn records thỏa mãn điều kiện`,
            );
            break;
          }

          batchNumber++;

          // Delay nhỏ giữa các batch để tránh overload
          await this.delay(200); // 200ms delay
        } catch (error) {
          this.logger.error(
            `❌ [Cleanup] Lỗi trong batch ${batchNumber}:`,
            error.message,
          );
          throw error;
        }
      }

      this.logger.log(
        `🎯 [Cleanup] Hoàn thành: ${totalDeleted} records trong ${batchNumber} batch(es) (dự kiến: ${totalToDelete})`,
      );

      return totalDeleted;
    } catch (error) {
      this.logger.error(
        `❌ [Cleanup] Lỗi khi cleanup bản ghi cũ:`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * Đảm bảo unique index tồn tại để chống trùng: (statistic_date, original_debt_id)
   * Nếu đã tồn tại sẽ bỏ qua lỗi.
   */
  private async ensureUniqueIndex(): Promise<void> {
    try {
      // Kiểm tra nhanh qua information_schema
      const check = await this.debtStatisticRepo.query(
        `SELECT COUNT(1) AS c
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = 'debt_statistics'
           AND index_name = 'uniq_stat_date_debt'`,
      );
      const exists = Number(check?.[0]?.c || 0) > 0;
      if (exists) return;

      this.logger.log(
        '🔐 [Index] Tạo unique index uniq_stat_date_debt(statistic_date, original_debt_id)',
      );
      await this.debtStatisticRepo.query(
        'ALTER TABLE debt_statistics ADD UNIQUE KEY uniq_stat_date_debt (statistic_date, original_debt_id)',
      );
    } catch (e) {
      // Nếu lỗi vì đã tồn tại hoặc không có quyền, ghi log cảnh báo và tiếp tục.
      this.logger.warn(
        `⚠️ [Index] Không thể tạo unique index (có thể đã tồn tại): ${e?.message || e}`,
      );
    }
  }
}

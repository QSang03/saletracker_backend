import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
// NKCProduct sync cron removed because VNK_API_PRODUCT_URL is deprecated
import { DebtStatistic } from '../debt_statistics/debt_statistic.entity';
import { Debt } from '../debts/debt.entity';
import { DebtHistory } from 'src/debt_histories/debt_histories.entity';
import { DatabaseChangeLog } from 'src/observers/change_log.entity';

@Injectable()
export class CronjobService {
  private readonly logger = new Logger(CronjobService.name);

  constructor(
  // http/config services removed — product/category sync crons disabled
  // NKCProduct repo not required by cronjob service anymore
    @InjectRepository(DebtStatistic)
    private debtStatisticRepo: Repository<DebtStatistic>,
    @InjectRepository(Debt)
    private debtRepo: Repository<Debt>,
    @InjectRepository(DebtHistory)
    private debtHistoryRepo: Repository<DebtHistory>,
    @InjectRepository(DatabaseChangeLog)
    private changeLogRepo: Repository<DatabaseChangeLog>,
  ) {
    this.logger.log(
      '🎯 [CronjobService] Service đã được khởi tạo - Cronjob debt statistics sẽ chạy lúc 11h trưa hàng ngày',
    );
  }

  @Cron(process.env.CRON_DEBT_STATISTICS_TIME || '0 23 * * *')
  async handleDebtStatisticsCron() {
    // Sử dụng timezone Việt Nam (UTC+7)
    const today = new Date();
    const vietnamTime = new Date(today.getTime() + 7 * 60 * 60 * 1000); // Add 7 hours
    const todayStr = vietnamTime.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    const vietnamDate = new Date(todayStr); // Parse as date for comparison

    this.logger.log(
      `🔄 [Auto Cron] Bắt đầu capture debt statistics cho ngày: ${todayStr}`,
    );

    try {
      // Kiểm tra đã có data cho ngày hôm nay chưa
      const existingCount = await this.debtStatisticRepo.count({
        where: { statistic_date: vietnamDate },
      });

      if (existingCount > 0) {
        this.logger.log(
          `⚠️ [Auto Cron] Đã có ${existingCount} bản ghi cho ngày ${todayStr}, bỏ qua`,
        );
        return;
      }

      // Raw query để copy ALL debts sang debt_statistics mỗi ngày
      // QUAN TRỌNG: Duplicate tất cả phiếu để có thống kê chính xác
      const query = `
        INSERT INTO debt_statistics (
          statistic_date, customer_raw_code, invoice_code, bill_code,
          total_amount, remaining, issue_date, due_date, pay_later,
          status, sale_id, sale_name_raw, employee_code_raw,
          debt_config_id, customer_code, customer_name, note,
          is_notified, original_created_at, original_updated_at, original_debt_id
        )
        SELECT 
          DATE(d.updated_at) as statistic_date,
          d.customer_raw_code, d.invoice_code, d.bill_code,
          d.total_amount, d.remaining, d.issue_date, d.due_date, d.pay_later,
          d.status, d.sale_id, d.sale_name_raw, d.employee_code_raw,
          d.debt_config_id, dc.customer_code, dc.customer_name, d.note,
          d.is_notified, d.created_at, d.updated_at, d.id
        FROM debts d
        LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
        WHERE d.deleted_at IS NULL
        AND DATE(d.updated_at) = ?
      `;

      const result = await this.debtStatisticRepo.query(query, [todayStr]);

      this.logger.log(
        `✅ [Auto Cron] Đã lưu ${result.affectedRows || 0} bản ghi cho ngày ${todayStr}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ [Auto Cron] Lỗi khi capture debt statistics:`,
        error,
      );
    }
  }

  // Method để chạy thủ công - có thể chạy bất cứ khi nào
  async captureDebtStatisticsManual(targetDate?: string) {
    const dateToCapture = targetDate || new Date().toISOString().split('T')[0];
    const captureDate = new Date(dateToCapture);
    captureDate.setHours(0, 0, 0, 0);

    this.logger.log(
      `🔄 [Thống kê công nợ - Thủ công] Bắt đầu capture cho ngày: ${dateToCapture}`,
    );

    try {
      // Kiểm tra đã có data cho ngày này chưa
      const existingCount = await this.debtStatisticRepo.count({
        where: { statistic_date: captureDate },
      });

      if (existingCount > 0) {
        this.logger.log(
          `⚠️ [Thống kê công nợ - Thủ công] Đã có ${existingCount} bản ghi cho ngày ${dateToCapture}`,
        );
        return {
          success: false,
          message: `Đã có dữ liệu thống kê cho ngày ${dateToCapture}`,
          existingRecords: existingCount,
        };
      }

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
        AND DATE(d.created_at) = ?
      `;

      this.logger.log(
        `💾 [Thống kê công nợ - Thủ công] Đang capture debts được tạo ngày ${dateToCapture}...`,
      );

      const result = await this.debtStatisticRepo.query(query, [dateToCapture]);

      this.logger.log(
        `✅ [Thống kê công nợ - Thủ công] Đã lưu ${result.affectedRows || 0} bản ghi cho ngày ${dateToCapture}`,
      );

      return {
        success: true,
        message: `Capture thành công ${result.affectedRows || 0} debt statistics`,
        recordsSaved: result.affectedRows || 0,
        date: dateToCapture,
        note: 'Sử dụng ngày tạo debt làm statistic_date',
      };
    } catch (error) {
      this.logger.error(
        `❌ [Thống kê công nợ - Thủ công] Lỗi khi capture debt statistics:`,
        error,
      );
      return {
        success: false,
        message: `Lỗi khi capture debt statistics: ${error.message}`,
        error: error.message,
      };
    }
  }

  // Product sync cron removed — VNK_API_PRODUCT_URL deprecated

  // Category sync removed — external service now provides categories differently and this cron is no longer needed.

  @Cron(process.env.CRON_CLONE_DEBT_LOGS_TIME || '0 23 * * *')
  async cloneDebtLogsToHistories() {
    const today = new Date();
    const vietnamTime = new Date(today.getTime() + 7 * 60 * 60 * 1000); // Cộng thêm 7 tiếng
    const todayStr = vietnamTime.toISOString().split('T')[0]; // Định dạng YYYY-MM-DD

    this.logger.log(
      `[CRON] Bắt đầu clone debt_logs sang debt_histories cho ngày ${todayStr}`,
    );

    const query = `
  INSERT INTO debt_histories (
    debt_log_id, debt_msg, send_at, user_name, full_name, first_remind, error_msg,
    first_remind_at, second_remind, second_remind_at, sale_msg, conv_id, debt_img,
    remind_status, gender, created_at
  )
  SELECT
    dl.id, dl.debt_msg, dl.send_at, u.username AS user_name, u.full_name,
    dl.first_remind, dl.error_msg, dl.first_remind_at, dl.second_remind,
    dl.second_remind_at, dl.sale_msg, dl.conv_id, dl.debt_img,
    dl.remind_status, dl.gender, NOW()
  FROM debt_logs dl
  LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
  LEFT JOIN users u ON dc.employee_id = u.id
  WHERE DATE(CONVERT_TZ(dl.updated_at, '+00:00', '+07:00')) = ?
    AND dl.id NOT IN (SELECT debt_log_id FROM debt_histories WHERE DATE(created_at) = ?)
`;
    const result = await this.debtHistoryRepo.query(query, [todayStr, todayStr]);

    this.logger.log(
      `[CRON] Đã clone xong debt_logs sang debt_histories cho ngày ${todayStr}`,
    );
    this.logger.debug(`[CRON] Query result: ${JSON.stringify(result)}`);
  }

  @Cron(process.env.CRON_DEL_DB_CHANGELOGS_TIME || '0 23 * * *')
  async clearDatabaseChangeLog() {
    const now = new Date();
    const vietnamHour = now.getUTCHours() + 7;
    if (vietnamHour !== 11) return;

    this.logger.log('[CRON] Bắt đầu xóa toàn bộ bảng database_change_log');
    try {
      await this.changeLogRepo.clear();
      this.logger.log(
        '[CRON] Đã xóa toàn bộ bảng database_change_log thành công',
      );
    } catch (error) {
      this.logger.error('[CRON] Lỗi khi xóa bảng database_change_log:', error);
    }
  }

  @Cron(process.env.CRON_DEBT_LOGS_TIME || '0 23 * * *')
  async snapshotAndResetDebtLogs() {
    const today = new Date();
    const vietnamTime = new Date(today.getTime() + 7 * 60 * 60 * 1000);
    const todayStr = vietnamTime.toISOString().split('T')[0];

    // 1. Snapshot các bản ghi debt_logs có send_at >= ngày hiện tại
    const insertQuery = `
    INSERT INTO debt_histories (
      created_at, remind_status, gender, debt_log_id, send_at, first_remind_at, second_remind_at,
      conv_id, debt_img, sale_msg, second_remind, debt_msg, first_remind, error_msg, user_name, full_name
    )
    SELECT
      NOW(), dl.remind_status, dl.gender, dl.id, dl.send_at, dl.first_remind_at, dl.second_remind_at,
      dl.conv_id, dl.debt_img, dl.sale_msg, dl.second_remind,
      IFNULL(dl.debt_msg, ''), dl.first_remind, dl.error_msg, u.username, u.full_name
    FROM debt_logs dl
    LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
    LEFT JOIN users u ON dc.employee_id = u.id
    WHERE dl.send_at >= ?
      AND dl.id NOT IN (SELECT debt_log_id FROM debt_histories WHERE DATE(created_at) = ?)
  `;
    await this.debtHistoryRepo.query(insertQuery, [todayStr, todayStr]);

    // 2. Reset toàn bộ debt_logs (không điều kiện WHERE)
    const updateQuery = `
    UPDATE debt_logs
    SET
      debt_msg = NULL,
      send_at = NULL,
      error_msg = NULL,
      first_remind = NULL,
      first_remind_at = NULL,
      second_remind = NULL,
      second_remind_at = NULL,
      sale_msg = NULL,
      debt_img = NULL,
      remind_status = 'Not Sent'
  `;
    await this.debtHistoryRepo.query(updateQuery);

    this.logger.log(
      `[CRON] Đã snapshot debt_logs (send_at >= ${todayStr}) và reset toàn bộ debt_logs.`,
    );
  }
}

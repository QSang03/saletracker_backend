import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DebtHistory } from '../debt_histories/debt_histories.entity';
import { WinstonLogger } from '../common/winston.logger';

@Injectable()
export class DebtHistoriesCronjobService {
  private readonly logger = new WinstonLogger(DebtHistoriesCronjobService.name);

  constructor(
    @InjectRepository(DebtHistory)
    private debtHistoryRepo: Repository<DebtHistory>,
  ) {
    this.logger.log(
      '🎯 [DebtHistoriesCronjobService] Service đã được khởi tạo - Cronjob debt histories sẽ chạy lúc 23h hàng ngày',
    );
  }

  @Cron(process.env.CRON_CLONE_DEBT_LOGS_TIME || '0 23 * * *')
  async cloneDebtLogsToHistories() {
    const today = new Date();
    const vietnamTime = new Date(today.getTime() + 7 * 60 * 60 * 1000); // Cộng thêm 7 tiếng
    const todayStr = vietnamTime.toISOString().split('T')[0]; // Định dạng YYYY-MM-DD

    this.logger.log(
      `[CRON] Bắt đầu clone debt_logs sang debt_histories cho ngày ${todayStr}`,
    );

    try {
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
        `✅ [CRON] Đã clone xong debt_logs sang debt_histories cho ngày ${todayStr}`,
      );
      this.logger.debug(`[CRON] Query result: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(
        `❌ [CRON] Lỗi khi clone debt_logs sang debt_histories:`,
        error,
      );
    }
  }

  @Cron(process.env.CRON_DEBT_LOGS_TIME || '0 23 * * *')
  async snapshotAndResetDebtLogs() {
    const today = new Date();
    const vietnamTime = new Date(today.getTime() + 7 * 60 * 60 * 1000);
    const todayStr = vietnamTime.toISOString().split('T')[0];

    this.logger.log(
      `[CRON] Bắt đầu snapshot và reset debt_logs cho ngày ${todayStr}`,
    );

    try {
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
      
      const snapshotResult = await this.debtHistoryRepo.query(insertQuery, [todayStr, todayStr]);

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
      
      const resetResult = await this.debtHistoryRepo.query(updateQuery);

      this.logger.log(
        `✅ [CRON] Đã snapshot debt_logs (send_at >= ${todayStr}) và reset toàn bộ debt_logs.`,
      );
      this.logger.debug(`[CRON] Snapshot result: ${JSON.stringify(snapshotResult)}`);
      this.logger.debug(`[CRON] Reset result: ${JSON.stringify(resetResult)}`);
    } catch (error) {
      this.logger.error(
        `❌ [CRON] Lỗi khi snapshot và reset debt_logs:`,
        error,
      );
    }
  }
}
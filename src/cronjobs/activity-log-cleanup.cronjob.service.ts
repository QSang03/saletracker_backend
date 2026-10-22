import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLog } from '../activity-logs/activity-log.entity';
import { WinstonLogger } from '../common/winston.logger';

/**
 * Dọn dẹp lịch sử thao tác cũ.
 *
 * Giữ lại N tháng gần nhất, N lấy từ env ACTIVITY_RETENTION_MONTHS
 * (mặc định 3 tháng). Lịch chạy lấy từ CRON_ACTIVITY_CLEANUP_TIME
 * (mặc định 04:00 sáng hằng ngày, giờ Việt Nam).
 *
 * Xoá theo batch để không dồn tải lên database.
 */
@Injectable()
export class ActivityLogCleanupCronjobService {
  private readonly logger = new WinstonLogger(
    ActivityLogCleanupCronjobService.name,
  );

  constructor(
    @InjectRepository(ActivityLog)
    private readonly activityLogRepository: Repository<ActivityLog>,
  ) {
    this.logger.log(
      '🎯 [ActivityLogCleanupCronjobService] Service đã được khởi tạo - Cronjob xóa lịch sử thao tác cũ sẽ chạy lúc 04h sáng hàng ngày (giờ Việt Nam)',
    );
  }

  /**
   * Xóa bản ghi thao tác cũ hơn thời hạn lưu trữ.
   * Cron mặc định: '0 4 * * *'
   */
  @Cron(process.env.CRON_ACTIVITY_CLEANUP_TIME || '0 4 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async clearOldActivityLogs() {
    const vietnamTime = new Date().toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    this.logger.log(
      `🔄 [Activity Log Cleanup Cron] Bắt đầu dọn lịch sử thao tác cũ lúc ${vietnamTime}`,
    );

    try {
      const retentionMonths = parseInt(
        process.env.ACTIVITY_RETENTION_MONTHS || '3',
        10,
      );
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);

      this.logger.log(
        `📊 [Activity Log Cleanup Cron] Xóa bản ghi cũ hơn ${retentionMonths} tháng (trước ${cutoffDate.toISOString()})`,
      );

      const countBefore = await this.activityLogRepository
        .createQueryBuilder('log')
        .where('log.occurred_at < :cutoffDate', { cutoffDate })
        .getCount();

      if (countBefore === 0) {
        this.logger.log(
          'ℹ️ [Activity Log Cleanup Cron] Không có bản ghi nào hết hạn cần xóa',
        );
        return;
      }

      this.logger.log(
        `📊 [Activity Log Cleanup Cron] Tìm thấy ${countBefore} bản ghi hết hạn trong user_activity_logs`,
      );

      const result = await this.clearActivityLogsInBatches(cutoffDate);

      this.logger.log(
        `✅ [Activity Log Cleanup Cron] Đã xóa thành công ${result.totalDeleted} bản ghi trong ${result.batches} batch`,
      );
    } catch (error) {
      this.logger.error(
        '❌ [Activity Log Cleanup Cron] Lỗi khi xóa lịch sử thao tác:',
        error.stack,
      );
    }
  }

  /**
   * Xóa theo batch để tránh tải nặng cho database.
   * @param batchSize Kích thước mỗi batch (mặc định 1000)
   */
  private async clearActivityLogsInBatches(
    cutoffDate: Date,
    batchSize: number = 1000,
  ): Promise<{ totalDeleted: number; batches: number }> {
    let totalDeleted = 0;
    let batches = 0;
    let hasMoreData = true;

    this.logger.log(
      `📦 [Activity Log Batch Delete] Bắt đầu xóa theo batch - Kích thước: ${batchSize}`,
    );

    while (hasMoreData) {
      const recordsToDelete = await this.activityLogRepository
        .createQueryBuilder('log')
        .select('log.id')
        .where('log.occurred_at < :cutoffDate', { cutoffDate })
        .orderBy('log.occurred_at', 'ASC') // Xóa từ cũ nhất
        .limit(batchSize)
        .getMany();

      if (recordsToDelete.length === 0) {
        this.logger.log(
          '📦 [Activity Log Batch Delete] Không còn bản ghi nào để xóa',
        );
        break;
      }

      const idsToDelete = recordsToDelete.map((record) => record.id);

      const deleteResult = await this.activityLogRepository
        .createQueryBuilder()
        .delete()
        .where('id IN (:...ids)', { ids: idsToDelete })
        .execute();

      const deletedInThisBatch = deleteResult.affected || 0;
      totalDeleted += deletedInThisBatch;
      batches++;

      this.logger.log(
        `📦 [Activity Log Batch Delete] Batch ${batches}: Đã xóa ${deletedInThisBatch} bản ghi (Tổng: ${totalDeleted})`,
      );

      if (deletedInThisBatch < batchSize) {
        hasMoreData = false;
        this.logger.log('📦 [Activity Log Batch Delete] Đã xóa hết dữ liệu');
      }

      // Nghỉ ngắn giữa các batch để giảm tải cho database
      if (hasMoreData) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    this.logger.log(
      `📦 [Activity Log Batch Delete] Hoàn thành: ${totalDeleted} bản ghi trong ${batches} batch`,
    );

    return { totalDeleted, batches };
  }
}

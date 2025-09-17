import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DatabaseChangeLog } from '../observers/change_log.entity';
import { WinstonLogger } from '../common/winston.logger';

@Injectable()
export class DatabaseCleanupCronjobService {
  private readonly logger = new WinstonLogger(DatabaseCleanupCronjobService.name);

  constructor(
    @InjectRepository(DatabaseChangeLog)
    private changeLogRepository: Repository<DatabaseChangeLog>,
  ) {
    this.logger.log(
      '🎯 [DatabaseCleanupCronjobService] Service đã được khởi tạo - Cronjob xóa database_change_log sẽ chạy lúc 23h đêm hàng ngày (giờ Việt Nam)',
    );
  }

  /**
   * Cronjob xóa database_change_log theo batch mỗi ngày lúc 23h đêm giờ Việt Nam
   * Cron expression: '0 23 * * *' = 23:00 mỗi ngày
   * Xóa theo batch để tránh tải nặng cho database
   */
  @Cron(process.env.CRON_DB_CLEANUP_TIME || '0 23 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh', // Sử dụng timezone Việt Nam
  })
  async clearDatabaseChangeLog() {
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
      `🔄 [Database Cleanup Cron] Bắt đầu xóa database_change_log theo batch lúc ${vietnamTime}`,
    );

    try {
      // Đếm số bản ghi trước khi xóa để log
      const countBefore = await this.changeLogRepository.count();
      
      if (countBefore === 0) {
        this.logger.log(
          'ℹ️ [Database Cleanup Cron] Bảng database_change_log đã trống, không có gì để xóa',
        );
        return;
      }

      this.logger.log(
        `📊 [Database Cleanup Cron] Tìm thấy ${countBefore} bản ghi trong database_change_log`,
      );

      // Xóa theo batch để tránh tải nặng
      const result = await this.clearDatabaseChangeLogInBatches();

      this.logger.log(
        `✅ [Database Cleanup Cron] Đã xóa thành công ${result.totalDeleted} bản ghi từ database_change_log trong ${result.batches} batch`,
      );
      this.logger.log(
        `🕐 [Database Cleanup Cron] Thời gian hoàn thành: ${vietnamTime}`,
      );
    } catch (error) {
      this.logger.error(
        '❌ [Database Cleanup Cron] Lỗi khi xóa database_change_log:',
        error.stack,
      );
    }
  }

  /**
   * Xóa database_change_log theo batch để tránh tải nặng cho database
   * @param batchSize Kích thước mỗi batch (mặc định 1000)
   * @param maxBatches Số batch tối đa để tránh chạy quá lâu (mặc định 100)
   */
  private async clearDatabaseChangeLogInBatches(
    batchSize: number = 1000,
    maxBatches: number = 100,
  ): Promise<{ totalDeleted: number; batches: number }> {
    let totalDeleted = 0;
    let batches = 0;
    let hasMoreData = true;

    this.logger.log(
      `📦 [Batch Delete] Bắt đầu xóa theo batch - Kích thước: ${batchSize}, Tối đa: ${maxBatches} batch`,
    );

    while (hasMoreData && batches < maxBatches) {
      try {
        // Lấy ID của các bản ghi cũ nhất để xóa
        const recordsToDelete = await this.changeLogRepository
          .createQueryBuilder('log')
          .select('log.id')
          .orderBy('log.triggered_at', 'ASC') // Xóa từ cũ nhất
          .limit(batchSize)
          .getMany();

        if (recordsToDelete.length === 0) {
          hasMoreData = false;
          this.logger.log('📦 [Batch Delete] Không còn bản ghi nào để xóa');
          break;
        }

        const idsToDelete = recordsToDelete.map(record => record.id);

        // Xóa batch hiện tại
        const deleteResult = await this.changeLogRepository
          .createQueryBuilder()
          .delete()
          .where('id IN (:...ids)', { ids: idsToDelete })
          .execute();

        const deletedInThisBatch = deleteResult.affected || 0;
        totalDeleted += deletedInThisBatch;
        batches++;

        this.logger.log(
          `📦 [Batch Delete] Batch ${batches}: Đã xóa ${deletedInThisBatch} bản ghi (Tổng: ${totalDeleted})`,
        );

        // Nếu số bản ghi xóa ít hơn batchSize thì đã hết dữ liệu
        if (deletedInThisBatch < batchSize) {
          hasMoreData = false;
          this.logger.log('📦 [Batch Delete] Đã xóa hết dữ liệu');
        }

        // Nghỉ ngắn giữa các batch để giảm tải cho database
        if (hasMoreData && batches < maxBatches) {
          await new Promise(resolve => setTimeout(resolve, 100)); // Nghỉ 100ms
        }
      } catch (error) {
        this.logger.error(
          `❌ [Batch Delete] Lỗi trong batch ${batches + 1}:`,
          error.stack,
        );
        throw error;
      }
    }

    if (batches >= maxBatches) {
      this.logger.warn(
        `⚠️ [Batch Delete] Đã đạt giới hạn ${maxBatches} batch, có thể còn dữ liệu chưa xóa`,
      );
    }

    this.logger.log(
      `📦 [Batch Delete] Hoàn thành: ${totalDeleted} bản ghi trong ${batches} batch`,
    );

    return { totalDeleted, batches };
  }
}

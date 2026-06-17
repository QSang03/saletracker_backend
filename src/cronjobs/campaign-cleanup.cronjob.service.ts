import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { CampaignContent } from '../campaign_contents/campaign_content.entity';
import { CampaignSchedule } from '../campaign_schedules/campaign_schedule.entity';
import { CampaignEmailReport } from '../campaign_email_reports/campaign_email_report.entity';
import { CampaignInteractionLog } from '../campaign_interaction_logs/campaign_interaction_log.entity';
import { CampaignCustomerMap } from '../campaign_customer_map/campaign_customer_map.entity';
import { WinstonLogger } from '../common/winston.logger';

@Injectable()
export class CampaignCleanupCronjobService {
  private readonly logger = new WinstonLogger(
    CampaignCleanupCronjobService.name,
  );

  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(CampaignContent)
    private readonly campaignContentRepository: Repository<CampaignContent>,
    @InjectRepository(CampaignSchedule)
    private readonly campaignScheduleRepository: Repository<CampaignSchedule>,
    @InjectRepository(CampaignEmailReport)
    private readonly campaignEmailReportRepository: Repository<CampaignEmailReport>,
    @InjectRepository(CampaignInteractionLog)
    private readonly campaignInteractionLogRepository: Repository<CampaignInteractionLog>,
    @InjectRepository(CampaignCustomerMap)
    private readonly campaignCustomerMapRepository: Repository<CampaignCustomerMap>,
  ) {
    this.logger.log(
      '🎯 [CampaignCleanupCronjobService] Service đã được khởi tạo - Cronjob xóa các chiến dịch cũ (3 tháng) sẽ chạy lúc 02h sáng hàng ngày (giờ Việt Nam)',
    );
  }

  /**
   * Cronjob dọn dẹp các chiến dịch cũ và dữ liệu liên quan
   * Chạy vào 2:00 sáng hàng ngày theo giờ Việt Nam
   * Cron expression: '0 2 * * *'
   */
  @Cron(process.env.CRON_CAMPAIGN_CLEANUP_TIME || '0 2 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async cleanOldCampaigns() {
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
      `🔄 [Campaign Cleanup Cron] Bắt đầu dọn dẹp các chiến dịch cũ hơn 3 tháng lúc ${vietnamTime}`,
    );

    try {
      const retentionMonths = parseInt(
        process.env.CAMPAIGN_RETENTION_MONTHS || '3',
        10,
      );
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);

      // Đếm số chiến dịch cũ trước khi xóa
      const oldCampaignCount = await this.campaignRepository
        .createQueryBuilder('campaign')
        .withDeleted() // Bao gồm cả những campaign đã soft delete
        .where('campaign.created_at < :cutoffDate', { cutoffDate })
        .getCount();

      if (oldCampaignCount === 0) {
        this.logger.log(
          `ℹ️ [Campaign Cleanup Cron] Không tìm thấy chiến dịch nào cũ hơn ${retentionMonths} tháng để dọn dẹp`,
        );
        return;
      }

      this.logger.log(
        `📊 [Campaign Cleanup Cron] Tìm thấy ${oldCampaignCount} chiến dịch cũ hơn ${retentionMonths} tháng cần dọn dẹp`,
      );

      // Thực hiện xóa theo batch để tránh quá tải
      const result = await this.clearCampaignsInBatches(cutoffDate);

      this.logger.log(
        `✅ [Campaign Cleanup Cron] Đã dọn dẹp thành công ${result.totalDeleted} chiến dịch trong ${result.batches} batch`,
      );
      this.logger.log(
        `🕐 [Campaign Cleanup Cron] Thời gian hoàn thành: ${vietnamTime}`,
      );
    } catch (error) {
      this.logger.error(
        '❌ [Campaign Cleanup Cron] Lỗi khi dọn dẹp chiến dịch:',
        error.stack,
      );
    }
  }

  /**
   * Xóa chiến dịch và các quan hệ phụ thuộc theo từng batch nhỏ
   */
  private async clearCampaignsInBatches(
    cutoffDate: Date,
    batchSize: number = 50,
    maxBatches: number = 100,
  ): Promise<{ totalDeleted: number; batches: number }> {
    let totalDeleted = 0;
    let batches = 0;
    let hasMoreData = true;

    this.logger.log(
      `📦 [Campaign Batch Delete] Bắt đầu xóa theo batch - Kích thước: ${batchSize}, Tối đa: ${maxBatches} batch`,
    );

    while (hasMoreData && batches < maxBatches) {
      const queryRunner =
        this.campaignRepository.manager.connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        // Lấy danh sách ID của các campaign cũ
        const campaignsToDelete = await this.campaignRepository
          .createQueryBuilder('campaign')
          .withDeleted()
          .select('campaign.id')
          .where('campaign.created_at < :cutoffDate', { cutoffDate })
          .limit(batchSize)
          .getMany();

        if (campaignsToDelete.length === 0) {
          hasMoreData = false;
          this.logger.log(
            '📦 [Campaign Batch Delete] Không còn chiến dịch nào để dọn dẹp',
          );
          await queryRunner.rollbackTransaction();
          break;
        }

        const campaignIds = campaignsToDelete.map((c) => c.id);

        // 1. Xóa campaign_interaction_logs
        await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from(CampaignInteractionLog)
          .where('campaign_id IN (:...campaignIds)', { campaignIds })
          .execute();

        // 2. Xóa campaign_customer_map
        await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from(CampaignCustomerMap)
          .where('campaign_id IN (:...campaignIds)', { campaignIds })
          .execute();

        // 3. Xóa campaign_contents
        await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from(CampaignContent)
          .where('campaign_id IN (:...campaignIds)', { campaignIds })
          .execute();

        // 4. Xóa campaign_schedules
        await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from(CampaignSchedule)
          .where('campaign_id IN (:...campaignIds)', { campaignIds })
          .execute();

        // 5. Xóa campaign_email_reports
        await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from(CampaignEmailReport)
          .where('campaign_id IN (:...campaignIds)', { campaignIds })
          .execute();

        // 6. Xóa campaign (hard delete)
        const deleteResult = await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from(Campaign)
          .where('id IN (:...campaignIds)', { campaignIds })
          .execute();

        await queryRunner.commitTransaction();

        const deletedInThisBatch = deleteResult.affected || 0;
        totalDeleted += deletedInThisBatch;
        batches++;

        this.logger.log(
          `📦 [Campaign Batch Delete] Batch ${batches}: Đã dọn dẹp ${deletedInThisBatch} chiến dịch (Tổng: ${totalDeleted})`,
        );

        if (deletedInThisBatch < batchSize) {
          hasMoreData = false;
          this.logger.log('📦 [Campaign Batch Delete] Đã dọn dẹp hết dữ liệu');
        }

        // Nghỉ ngắn để giảm tải cho DB
        if (hasMoreData && batches < maxBatches) {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(
          `❌ [Campaign Batch Delete] Lỗi trong batch ${batches + 1}:`,
          error.stack,
        );
        throw error;
      } finally {
        await queryRunner.release();
      }
    }

    if (batches >= maxBatches) {
      this.logger.warn(
        `⚠️ [Campaign Batch Delete] Đã đạt giới hạn ${maxBatches} batch, có thể còn dữ liệu chưa dọn dẹp`,
      );
    }

    this.logger.log(
      `📦 [Campaign Batch Delete] Hoàn thành: ${totalDeleted} chiến dịch trong ${batches} batch`,
    );

    return { totalDeleted, batches };
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { 
  DepartmentSchedule, 
  ScheduleType, 
  ScheduleStatus,
  DailyDatesConfig,
  HourlySlotsConfig 
} from '../campaign_departments_schedules/campaign_departments_schedules.entity';
import { ScheduleCalculatorHelper } from '../campaigns/helpers/schedule-calculator.helper';
import { Campaign, CampaignStatus } from '../campaigns/campaign.entity';
import { CampaignSchedule } from '../campaign_schedules/campaign_schedule.entity';

@Injectable()
export class ScheduleStatusUpdaterService {
  private readonly logger = new Logger(ScheduleStatusUpdaterService.name);

  constructor(
    @InjectRepository(DepartmentSchedule)
    private readonly departmentScheduleRepository: Repository<DepartmentSchedule>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(CampaignSchedule)
    private readonly campaignScheduleRepository: Repository<CampaignSchedule>,
  ) {}

  /**
   * Cronjob chạy mỗi phút để cập nhật status của department schedules
   * - Chuyển status thành 'active' cho schedules trong khung thời gian hiệu lực
   * - Chuyển status thành 'expired' cho schedules đã hết hạn
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async updateScheduleStatuses(): Promise<void> {
    try {
      this.logger.debug('Bắt đầu cập nhật schedule statuses...');
      
      // Lấy tất cả schedules không phải trạng thái 'inactive'
      const schedules = await this.departmentScheduleRepository.find({
        where: [
          { status: ScheduleStatus.ACTIVE },
          { status: ScheduleStatus.EXPIRED }
        ],
        relations: ['department'],
      });

      let updatedCount = 0;
      const now = new Date();

      for (const schedule of schedules) {
        try {
          const newStatus = this.calculateScheduleStatus(schedule, now);
          
          // Chỉ update nếu status thay đổi
          if (newStatus !== schedule.status) {
            await this.departmentScheduleRepository.update(schedule.id, {
              status: newStatus
            });
            
            updatedCount++;
            this.logger.log(
              `Updated schedule "${schedule.name}" (ID: ${schedule.id}) ` +
              `from ${schedule.status} to ${newStatus}`
            );
          }
        } catch (error) {
          this.logger.error(
            `Lỗi khi cập nhật schedule ID ${schedule.id}: ${error.message}`,
            error.stack
          );
        }
      }

      if (updatedCount > 0) {
        this.logger.log(`Đã cập nhật ${updatedCount} schedule statuses`);
      } else {
        this.logger.debug('Không có schedule nào cần cập nhật status');
      }

    } catch (error) {
      this.logger.error(
        'Lỗi trong quá trình cập nhật schedule statuses:',
        error.stack
      );
    }
  }

  /**
   * Cronjob chạy vào cuối tuần (Chủ nhật lúc 23:59) để reset campaign SCHEDULED 
   * mà không có start_date và end_date về trạng thái DRAFT
   */
  @Cron('59 23 * * 0') // Chạy vào Chủ nhật lúc 23:59
  async resetInvalidScheduledCampaigns(): Promise<void> {
    try {
      this.logger.debug('Bắt đầu kiểm tra và reset campaigns SCHEDULED không hợp lệ...');
      
      // Tìm các campaign có status SCHEDULED
      const scheduledCampaigns = await this.campaignRepository.find({
        where: { status: CampaignStatus.SCHEDULED },
        relations: ['department'],
      });

      let resetCount = 0;

      for (const campaign of scheduledCampaigns) {
        try {
          // Kiểm tra xem campaign có campaign_schedule không
          const campaignSchedule = await this.campaignScheduleRepository.findOne({
            where: { campaign: { id: campaign.id } },
          });

          // Nếu không có campaign_schedule hoặc start_date và end_date đều null
          if (!campaignSchedule || (!campaignSchedule.start_date && !campaignSchedule.end_date)) {
            // Reset về trạng thái DRAFT
            await this.campaignRepository.update(campaign.id, {
              status: CampaignStatus.DRAFT
            });

            resetCount++;
            this.logger.log(
              `Reset campaign "${campaign.name}" (ID: ${campaign.id}) ` +
              `từ SCHEDULED về DRAFT (không có start_date và end_date)`
            );
          }
        } catch (error) {
          this.logger.error(
            `Lỗi khi kiểm tra campaign ID ${campaign.id}: ${error.message}`,
            error.stack
          );
        }
      }

      if (resetCount > 0) {
        this.logger.log(`Đã reset ${resetCount} campaigns SCHEDULED không hợp lệ về DRAFT`);
      } else {
        this.logger.debug('Không có campaign SCHEDULED nào cần reset');
      }

    } catch (error) {
      this.logger.error(
        'Lỗi trong quá trình reset campaigns SCHEDULED không hợp lệ:',
        error.stack
      );
    }
  }

  /**
   * Tính toán status mới cho schedule dựa vào thời gian hiện tại
   * @param schedule - Department schedule
   * @param currentTime - Thời gian hiện tại
   * @returns Status mới
   */
  private calculateScheduleStatus(
    schedule: DepartmentSchedule, 
    currentTime: Date
  ): ScheduleStatus {
    // Nếu schedule bị set thành inactive thủ công, không thay đổi
    if (schedule.status === ScheduleStatus.INACTIVE) {
      return ScheduleStatus.INACTIVE;
    }

    try {
      // Sử dụng helper để check thời gian hiện tại có trong schedule không
      const isCurrentlyInSchedule = ScheduleCalculatorHelper.isCurrentTimeInSchedule(
        schedule.schedule_config,
        schedule.schedule_type,
        currentTime
      );

      if (isCurrentlyInSchedule) {
        return ScheduleStatus.ACTIVE;
      } else {
        // Check xem đã quá thời gian hay chưa tới thời gian
        const scheduleDetails = ScheduleCalculatorHelper.getScheduleDetails(
          schedule.schedule_config,
          schedule.schedule_type
        );

        if (currentTime > scheduleDetails.endDate) {
          return ScheduleStatus.EXPIRED;
        } else {
          // Chưa tới thời gian bắt đầu, giữ nguyên status hiện tại
          // hoặc set thành INACTIVE nếu muốn
          return schedule.status;
        }
      }
    } catch (error) {
      this.logger.warn(
        `Không thể tính toán status cho schedule ID ${schedule.id}: ${error.message}`
      );
      // Giữ nguyên status hiện tại nếu có lỗi
      return schedule.status;
    }
  }

  /**
   * Manually trigger update (useful for testing)
   */
  async manualUpdateScheduleStatuses(): Promise<{
    updated: number;
    total: number;
  }> {
    this.logger.log('Manual trigger schedule status update...');
    
    const schedules = await this.departmentScheduleRepository.find({
      relations: ['department'],
    });

    let updatedCount = 0;
    const now = new Date();

    for (const schedule of schedules) {
      const newStatus = this.calculateScheduleStatus(schedule, now);
      
      if (newStatus !== schedule.status) {
        await this.departmentScheduleRepository.update(schedule.id, {
          status: newStatus
        });
        updatedCount++;
      }
    }

    this.logger.log(`Manual update completed: ${updatedCount}/${schedules.length} schedules updated`);
    
    return {
      updated: updatedCount,
      total: schedules.length
    };
  }

  /**
   * Manual trigger reset invalid scheduled campaigns (useful for testing)
   */
  async manualResetInvalidScheduledCampaigns(): Promise<{
    reset: number;
    total: number;
  }> {
    this.logger.log('Manual trigger reset invalid scheduled campaigns...');
    
    const scheduledCampaigns = await this.campaignRepository.find({
      where: { status: CampaignStatus.SCHEDULED },
      relations: ['department'],
    });

    let resetCount = 0;

    for (const campaign of scheduledCampaigns) {
      const campaignSchedule = await this.campaignScheduleRepository.findOne({
        where: { campaign: { id: campaign.id } },
      });

      if (!campaignSchedule || (!campaignSchedule.start_date && !campaignSchedule.end_date)) {
        await this.campaignRepository.update(campaign.id, {
          status: CampaignStatus.DRAFT
        });
        resetCount++;
      }
    }

    this.logger.log(`Manual reset completed: ${resetCount}/${scheduledCampaigns.length} campaigns reset`);
    
    return {
      reset: resetCount,
      total: scheduledCampaigns.length
    };
  }

  /**
   * Get thống kê về schedule statuses
   */
  async getScheduleStatusStats(): Promise<{
    active: number;
    inactive: number;
    expired: number;
    total: number;
  }> {
    const [active, inactive, expired, total] = await Promise.all([
      this.departmentScheduleRepository.count({ where: { status: ScheduleStatus.ACTIVE } }),
      this.departmentScheduleRepository.count({ where: { status: ScheduleStatus.INACTIVE } }),
      this.departmentScheduleRepository.count({ where: { status: ScheduleStatus.EXPIRED } }),
      this.departmentScheduleRepository.count(),
    ]);

    return { active, inactive, expired, total };
  }
}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { CronjobService } from '../cronjobs/cronjob.service';
import { ProductV2CronjobService } from './product-v2.cronjob.service';
import { DebtStatisticsCronjobService } from './debt-statistics.cronjob.service';
import { DebtHistoriesCronjobService } from './debt-histories.cronjob.service';
import { OrderCleanupCronjobService } from './order-cleanup.cronjob.service';
import { DatabaseCleanupCronjobService } from './database-cleanup.cronjob.service';
import { NKCProduct } from '../nkc_products/nkc_product.entity';
import { Product } from '../products/product.entity';
import { Brand } from '../brands/brand.entity';
import { Category } from '../categories/category.entity';
import { DebtStatistic } from '../debt_statistics/debt_statistic.entity';
import { Debt } from '../debts/debt.entity';
import { DebtHistory } from 'src/debt_histories/debt_histories.entity';
import { DatabaseChangeLog } from 'src/observers/change_log.entity';
import { DepartmentSchedule } from '../campaign_departments_schedules/campaign_departments_schedules.entity';
import { Campaign } from '../campaigns/campaign.entity';
import { CampaignSchedule } from '../campaign_schedules/campaign_schedule.entity';
import { CampaignContent } from '../campaign_contents/campaign_content.entity';
import { CampaignEmailReport } from '../campaign_email_reports/campaign_email_report.entity';
import { CampaignInteractionLog } from '../campaign_interaction_logs/campaign_interaction_log.entity';
import { CampaignCustomerMap } from '../campaign_customer_map/campaign_customer_map.entity';
import { CampaignCleanupCronjobService } from './campaign-cleanup.cronjob.service';
import { PermissionModule } from '../permissions/permission.module';
import { ScheduleStatusUpdaterService } from './schedule-status-updater.service';
import { OrderDetail } from 'src/order-details/order-detail.entity';
import { SystemConfig } from 'src/system_config/system_config.entity';
import { ZaloLinkMonitorCronjob } from './zalo-link-monitor.cronjob';
import { User } from '../users/user.entity';
import { UserModule } from '../users/user.module';
import { ActivityLog } from '../activity-logs/activity-log.entity';
import { ActivityLogCleanupCronjobService } from './activity-log-cleanup.cronjob.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule,
    PermissionModule,
    UserModule, // Import UserModule để có UserStatusObserver
    TypeOrmModule.forFeature([
      NKCProduct,
      Product,
      Brand,
      Category,
      DebtStatistic,
      Debt,
      DebtHistory,
      DatabaseChangeLog,
      DepartmentSchedule,
      Campaign,
      CampaignSchedule,
      CampaignContent,
      CampaignEmailReport,
      CampaignInteractionLog,
      CampaignCustomerMap,
      OrderDetail, // Entity cho order details
      SystemConfig,
      User, // Thêm User entity
      ActivityLog, // Lịch sử thao tác người dùng trên UI
    ]),
  ],
  providers: [
    CronjobService, // Service chính (chỉ để thông tin)
    ScheduleStatusUpdaterService,
    // Các cronjob service riêng biệt
    DebtStatisticsCronjobService,
    DebtHistoriesCronjobService,
    OrderCleanupCronjobService,
    DatabaseCleanupCronjobService,
    ProductV2CronjobService,
    ZaloLinkMonitorCronjob, // Thêm cronjob monitor Zalo link
    CampaignCleanupCronjobService,
    ActivityLogCleanupCronjobService,
  ],
  exports: [
    CronjobService,
    ScheduleStatusUpdaterService,
    DebtStatisticsCronjobService,
    DebtHistoriesCronjobService,
    OrderCleanupCronjobService,
    DatabaseCleanupCronjobService,
    ProductV2CronjobService,
    ZaloLinkMonitorCronjob,
    CampaignCleanupCronjobService,
    ActivityLogCleanupCronjobService,
  ],
})
export class CronjobModule {}

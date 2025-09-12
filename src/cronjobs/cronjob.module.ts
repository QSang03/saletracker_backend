import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import { CronjobService } from '../cronjobs/cronjob.service';
import { ProductV2CronjobService } from './product-v2.cronjob.service';
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
import { PermissionModule } from '../permissions/permission.module';
import { ScheduleStatusUpdaterService } from './schedule-status-updater.service';
import { OrderDetail } from 'src/order-details/order-detail.entity';
import { SystemConfig } from 'src/system_config/system_config.entity';
import { OrderCleanupCronjobService } from './order-cleanup.cronjob.service';
import { DatabaseCleanupCronjobService } from './database-cleanup.cronjob.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    HttpModule,
    PermissionModule,
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
      OrderDetail, // Entity cho order details
      SystemConfig,
    ]),
  ],
  providers: [
    CronjobService,
    ScheduleStatusUpdaterService,
    OrderCleanupCronjobService,
    ProductV2CronjobService,
    DatabaseCleanupCronjobService,
  ],
  exports: [
    CronjobService,
    ScheduleStatusUpdaterService,
    OrderCleanupCronjobService,
    ProductV2CronjobService,
    DatabaseCleanupCronjobService,
  ],
})
export class CronjobModule {}

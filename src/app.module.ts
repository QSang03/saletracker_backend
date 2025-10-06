import { WebsocketModule } from './websocket/websocket.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { MulterModule } from '@nestjs/platform-express';
import { UserModule } from './users/user.module';
import { AuthModule } from './auth/auth.module';
import { RoleModule } from './roles/role.module';
import { PermissionModule } from './permissions/permission.module';
import { DepartmentModule } from './departments/department.module';
import { SeedModule } from './seed/seed.module';
import { typeOrmConfig } from './config/typeorm.config';
import { ConfigModule } from '@nestjs/config';
import { SystemConfigModule } from './system_config/system_config.module';
import { NKCProductModule } from './nkc_products/nkc_product.module';
import { ProductModule } from './products/product.module';
import { CategoryModule } from './categories/category.module';
import { BrandModule } from './brands/brand.module';
import { CronjobModule } from './cronjobs/cronjob.module';
import { DebtConfigsModule } from './debt_configs/debt_configs.module';
import { DebtModule } from './debts/debt.module';
import { DebtLogsModule } from './debt_logs/debt_logs.module';
import { DebtHistoriesModule } from './debt_histories/debt_histories.module';
import { RolesPermissionsModule } from './roles_permissions/roles-permissions.module';
import { NotificationModule } from './notifications/notification.module';
import { OrderModule } from './orders/order.module';
import { OrderDetailModule } from './order-details/order-detail.module';
import { WebhookModule } from './webhook/webhook.module';
import { DebtStatisticModule } from './debt_statistics/debt_statistic.module';
import { ObserversModule } from './observers/observers.module';
import { CampaignModule } from './campaigns/campaign.module';
import { CampaignCustomerModule } from './campaign_customers/campaign_customer.module';
import { CampaignInteractionLogModule } from './campaign_interaction_logs/campaign_interaction_log.module';
import { CampaignEmailReportModule } from './campaign_email_reports/campaign_email_report.module';
import { CampaignScheduleModule } from './campaign_schedules/campaign_schedule.module';
import { CampaignContentModule } from './campaign_contents/campaign_content.module';
import { CampaignDepartmentsSchedulesModule } from './campaign_departments_schedules/campaign_departments_schedules.module';
import { OrderBlacklistModule } from './order-blacklist/order-blacklist.module';
import { AnalysisBlockModule } from './analysis-block/analysis-block.module';
import { AutoReplyModule } from './auto_reply/auto_reply.module';
import { AutoGreetingModule } from './auto_greeting/auto_greeting.module';
import { OrderInquiryPresetModule } from './order_inquiry_presets/order_inquiry_preset.module';
import { CommonModule } from './common/common.module';
import { SendHistoryModule } from './send_history/send_history.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot(typeOrmConfig),
    MulterModule.register({
      dest: './uploads',
    }),
    AuthModule,
    UserModule,
    RoleModule,
    PermissionModule,
    DepartmentModule,
    SeedModule,
    SystemConfigModule,
    NKCProductModule,
    ProductModule,
    CategoryModule,
    BrandModule,
    CronjobModule,
    DebtConfigsModule,
    DebtModule,
    DebtLogsModule,
    DebtHistoriesModule,
    RolesPermissionsModule,
    NotificationModule,
    OrderModule,
    OrderDetailModule,
    OrderBlacklistModule,
    AnalysisBlockModule,
    WebhookModule,
    DebtStatisticModule,
    WebsocketModule,
    ObserversModule,
    CampaignModule,
    CampaignCustomerModule,
    CampaignInteractionLogModule,
    CampaignEmailReportModule,
    CampaignScheduleModule,
    CampaignContentModule,
    CampaignDepartmentsSchedulesModule,
    AutoReplyModule,
    AutoGreetingModule,
  SendHistoryModule,
    OrderInquiryPresetModule,
    CommonModule,
  ],
})
export class AppModule {}

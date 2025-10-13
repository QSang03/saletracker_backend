import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignDepartmentsSchedulesService } from './campaign_departments_schedules.service';
import { CampaignDepartmentsSchedulesController } from './campaign_departments_schedules.controller';
import { DepartmentSchedule } from './campaign_departments_schedules.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';
import { ScheduleStatusUpdaterService } from '../cronjobs/schedule-status-updater.service';
import { Campaign } from '../campaigns/campaign.entity';
import { CampaignSchedule } from '../campaign_schedules/campaign_schedule.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DepartmentSchedule, User, Department, Campaign, CampaignSchedule])
  ],
  controllers: [CampaignDepartmentsSchedulesController],
  providers: [CampaignDepartmentsSchedulesService, ScheduleStatusUpdaterService],
  exports: [CampaignDepartmentsSchedulesService],
})
export class CampaignDepartmentsSchedulesModule {}

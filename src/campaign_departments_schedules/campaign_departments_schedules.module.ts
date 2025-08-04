import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignDepartmentsSchedulesService } from './campaign_departments_schedules.service';
import { CampaignDepartmentsSchedulesController } from './campaign_departments_schedules.controller';
import { DepartmentSchedule } from './campaign_departments_schedules.entity';
import { CronjobModule } from '../cronjobs/cronjob.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DepartmentSchedule]),
    CronjobModule
  ],
  controllers: [CampaignDepartmentsSchedulesController],
  providers: [CampaignDepartmentsSchedulesService],
  exports: [CampaignDepartmentsSchedulesService],
})
export class CampaignDepartmentsSchedulesModule {}

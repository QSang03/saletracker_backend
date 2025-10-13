import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CampaignDepartmentsSchedulesService } from './campaign_departments_schedules.service';
import { CampaignDepartmentsSchedulesController } from './campaign_departments_schedules.controller';
import { DepartmentSchedule } from './campaign_departments_schedules.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([DepartmentSchedule, User, Department])
  ],
  controllers: [CampaignDepartmentsSchedulesController],
  providers: [CampaignDepartmentsSchedulesService],
  exports: [CampaignDepartmentsSchedulesService],
})
export class CampaignDepartmentsSchedulesModule {}

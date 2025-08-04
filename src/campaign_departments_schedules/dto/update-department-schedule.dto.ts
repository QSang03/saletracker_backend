import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsEnum, IsObject, IsNumber } from 'class-validator';
import { CreateDepartmentScheduleDto } from './create-department-schedule.dto';
import { ScheduleStatus, DailyDatesConfig, HourlySlotsConfig } from '../campaign_departments_schedules.entity';

export class UpdateDepartmentScheduleDto extends PartialType(CreateDepartmentScheduleDto) {
  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;

  @IsOptional()
  @IsObject()
  schedule_config?: DailyDatesConfig | HourlySlotsConfig;
}

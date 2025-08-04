import { IsNotEmpty, IsString, IsEnum, IsOptional, IsNumber, IsObject, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { ScheduleType, ScheduleStatus, DailyDatesConfig, HourlySlotsConfig } from '../campaign_departments_schedules.entity';

export class CreateDepartmentScheduleDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNotEmpty()
  @IsEnum(ScheduleType)
  schedule_type: ScheduleType;

  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;

  @IsNotEmpty()
  @IsObject()
  schedule_config: DailyDatesConfig | HourlySlotsConfig;

  @IsNotEmpty()
  @IsNumber()
  department_id: number;
}

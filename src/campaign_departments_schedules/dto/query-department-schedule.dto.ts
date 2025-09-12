import { IsOptional, IsString, IsEnum, IsNumber } from 'class-validator';
import { ScheduleType, ScheduleStatus } from '../campaign_departments_schedules.entity';

export class QueryDepartmentScheduleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(ScheduleType)
  schedule_type?: ScheduleType;

  @IsOptional()
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;

  @IsOptional()
  @IsNumber()
  department_id?: number;

  @IsOptional()
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  limit?: number = 999999;

  @IsOptional()
  @IsString()
  sort?: string = 'created_at';

  @IsOptional()
  @IsString()
  order?: 'ASC' | 'DESC' = 'DESC';
}

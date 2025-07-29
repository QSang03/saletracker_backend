import { 
  IsString, 
  IsNotEmpty, 
  IsEnum, 
  IsOptional, 
  IsIn, 
  IsNumberString, 
  IsObject, 
  IsArray, 
  ValidateNested, 
  IsBoolean,
  IsNumber
} from 'class-validator';
import { Type } from 'class-transformer';
import { CampaignType, CampaignStatus, SendMethod } from './campaign.entity';

export class AttachmentDto {
  @IsString()
  type: 'image' | 'link' | 'file';

  @IsString()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  base64?: string;

  @IsString()
  @IsOptional()
  filename?: string;
}

export class MessageDto {
  @IsString()
  type: 'initial';

  @IsString()
  @IsNotEmpty()
  text: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AttachmentDto)
  attachment?: AttachmentDto;
}

export class ScheduleConfigDto {
  @IsString()
  @IsIn(['hourly', '3_day', 'weekly'])
  type: 'hourly' | '3_day' | 'weekly';

  @IsString()
  @IsOptional()
  start_time?: string;

  @IsString()
  @IsOptional()
  end_time?: string;

  @IsNumber()
  @IsOptional()
  remind_after_minutes?: number;

  @IsArray()
  @IsOptional()
  days_of_week?: number[];

  @IsNumber()
  @IsOptional()
  day_of_week?: number;

  @IsString()
  @IsOptional()
  time_of_day?: string;
}

export class ReminderDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsNumber()
  minutes: number;
}

export class EmailReportsDto {
  @IsString()
  @IsNotEmpty()
  recipients_to: string;

  @IsArray()
  @IsOptional()
  recipients_cc?: string[];

  @IsNumber()
  @IsOptional()
  report_interval_minutes?: number;

  @IsString()
  @IsOptional()
  stop_sending_at_time?: string;

  @IsBoolean()
  is_active: boolean;

  @IsBoolean()
  send_when_campaign_completed: boolean;
}

export class CustomerDto {
  @IsString()
  @IsNotEmpty()
  phone_number: string;

  @IsString()
  @IsNotEmpty()
  full_name: string;

  @IsString()
  @IsOptional()
  salutation?: string;
}

export class CreateCampaignDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(CampaignType)
  campaign_type: CampaignType;

  @IsEnum(CampaignStatus)
  @IsOptional()
  status?: CampaignStatus;

  @IsEnum(SendMethod)
  @IsOptional()
  send_method?: SendMethod;

  @IsNumberString()
  @IsOptional()
  department_id?: string;

  @IsNumberString()
  @IsOptional()
  created_by?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MessageDto)
  messages?: MessageDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleConfigDto)
  schedule_config?: ScheduleConfigDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderDto)
  reminders?: ReminderDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => EmailReportsDto)
  email_reports?: EmailReportsDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerDto)
  customers?: CustomerDto[];
}

export class UpdateCampaignDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(CampaignType)
  @IsOptional()
  campaign_type?: CampaignType;

  @IsEnum(CampaignStatus)
  @IsOptional()
  status?: CampaignStatus;

  @IsEnum(SendMethod)
  @IsOptional()
  send_method?: SendMethod;

  @IsNumberString()
  @IsOptional()
  department_id?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MessageDto)
  messages?: MessageDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ScheduleConfigDto)
  schedule_config?: ScheduleConfigDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReminderDto)
  reminders?: ReminderDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => EmailReportsDto)
  email_reports?: EmailReportsDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomerDto)
  customers?: CustomerDto[];
}

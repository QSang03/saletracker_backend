import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { Department } from '../departments/department.entity';
import { User } from '../users/user.entity';

// Enum cho loại lịch trình
export enum ScheduleType {
  DAILY_DATES = 'daily_dates',      // Lịch theo ngày trong tháng
  HOURLY_SLOTS = 'hourly_slots',    // Lịch theo khung giờ trong ngày
}

// Enum cho trạng thái lịch trình
export enum ScheduleStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  EXPIRED = 'expired',
}

// ===============================
// TYPE DEFINITIONS cho JSON Config
// ===============================

// Config cho lịch theo ngày
export interface DailyDatesConfig {
  type: 'daily_dates';
  dates: Array<{
    day_of_month: number;        // 1-31
    month?: number;              // 1-12, null = mọi tháng
    year?: number;               // null = mọi năm
    activity_description?: string;
    metadata?: {
      priority?: 'low' | 'medium' | 'high';
      tags?: string[];
      notes?: string;
      reminder_enabled?: boolean;
      [key: string]: any;
    };
  }>;
}

// Config cho lịch theo khung giờ
export interface HourlySlotsConfig {
  type: 'hourly_slots';
  slots: Array<{
    day_of_week?: number;        // 2-7 (2=Thứ 2, ..., 7=Thứ 7), không bao gồm Chủ nhật, null = mọi ngày
    start_time: string;          // "HH:mm:ss"
    end_time: string;            // "HH:mm:ss"
    activity_description?: string;
    metadata?: {
      priority?: 'low' | 'medium' | 'high';
      tags?: string[];
      notes?: string;
      reminder_minutes?: number;
      auto_execute?: boolean;
      [key: string]: any;
    };
  }>;
}

// Union type cho schedule config
export type ScheduleConfig = DailyDatesConfig | HourlySlotsConfig;

// ===============================
// MAIN ENTITY
// ===============================

@Entity('department_schedules')
export class DepartmentSchedule {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'enum', enum: ScheduleType })
  schedule_type: ScheduleType;

  @Column({ type: 'enum', enum: ScheduleStatus, default: ScheduleStatus.ACTIVE })
  status: ScheduleStatus;

  // JSON config chứa toàn bộ thông tin lịch trình
  @Column({ type: 'json' })
  schedule_config: ScheduleConfig;

  @ManyToOne(() => Department, { nullable: false })
  department: Department;

  @ManyToOne(() => User, { nullable: false })
  created_by: User;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @DeleteDateColumn({ nullable: true })
  deleted_at: Date | null;
}
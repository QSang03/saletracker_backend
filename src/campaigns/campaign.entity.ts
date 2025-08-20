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
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';

export enum CampaignType {
  HOURLY_KM = 'hourly_km',
  DAILY_KM = 'daily_km',
  THREE_DAY_KM = '3_day_km',
  WEEKLY_SP = 'weekly_sp',
  WEEKLY_BBG = 'weekly_bbg',
}

export enum CampaignStatus {
  DRAFT = 'draft',
  SCHEDULED = 'scheduled',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

export enum SendMethod {
  API = 'api',
  BOT = 'bot',
}

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Index()
  @Column({ type: 'enum', enum: CampaignType })
  campaign_type: CampaignType;

  @Index()
  @Column({ type: 'enum', enum: CampaignStatus, default: CampaignStatus.DRAFT })
  status: CampaignStatus;

  @Index()
  @Column({ type: 'enum', enum: SendMethod, default: SendMethod.BOT })
  send_method: SendMethod;

  @Index()
  @ManyToOne(() => Department, { nullable: false })
  department: Department;

  @Index()
  @ManyToOne(() => User, { nullable: false })
  created_by: User;

  @Index()
  @CreateDateColumn()
  created_at: Date;

  @Index()
  @UpdateDateColumn()
  updated_at: Date;

  @DeleteDateColumn({ nullable: true })
  deleted_at: Date | null;
}

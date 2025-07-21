import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Index } from 'typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { CampaignCustomer } from '../campaign_customers/campaign_customer.entity';
import { User } from '../users/user.entity';
import { ReminderMetadata } from 'src/campaign_config/reminder_metadata';

export enum LogStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  CUSTOMER_REPLIED = 'customer_replied',
  STAFF_HANDLED = 'staff_handled',
  REMINDER_SENT = 'reminder_sent',
}

@Entity('campaign_interaction_logs')
export class CampaignInteractionLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @ManyToOne(() => Campaign, { nullable: false })
  @Index()
  campaign: Campaign;

  @ManyToOne(() => CampaignCustomer, { nullable: false })
  @Index()
  customer: CampaignCustomer;

  @Column({ type: 'text' })
  message_content_sent: string;

  @Column({ type: 'json', nullable: true })
  attachment_sent?: Record<string, any>;

  @Column({ type: 'enum', enum: LogStatus })
  @Index()
  status: LogStatus;

  @Column({ nullable: true })
  sent_at?: Date;

  @Column({ nullable: true })
  customer_replied_at?: Date;

  @Column({ type: 'text', nullable: true })
  customer_reply_content?: string;

  @Column({ nullable: true })
  staff_handled_at?: Date;

  @Column({ type: 'text', nullable: true })
  staff_reply_content?: string;

  @ManyToOne(() => User, { nullable: true })
  staff_handler?: User;

  @Column({ type: 'json', nullable: true })
  error_details?: Record<string, any>;

  @Column({ type: 'json', nullable: true })
  conversation_metadata?: Record<string, any>;

  // Nội dung và thời gian gửi nhắc lại, lưu dưới dạng metadata
  @Column({ type: 'json', nullable: true })
  reminder_metadata?: ReminderMetadata;
}

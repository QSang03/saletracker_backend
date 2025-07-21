import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn, Check } from 'typeorm';
import { Campaign } from '../campaigns/campaign.entity';

@Entity('campaign_email_reports')
@Check(`"report_interval_minutes" > 0 OR "send_when_campaign_completed" = true`)
export class CampaignEmailReport {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @OneToOne(() => Campaign, { nullable: false })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column({ type: 'text', nullable: false })
  recipients_to: string;

  @Column({ type: 'json', nullable: true })
  recipients_cc?: string[];

  @Column({ type: 'int', nullable: true })
  report_interval_minutes?: number;

  @Column({ type: 'time', nullable: true })
  stop_sending_at_time?: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'boolean', default: false })
  send_when_campaign_completed: boolean;

  // Ensure business logic at entity level
  setSendWhenCampaignCompleted(value: boolean) {
    this.send_when_campaign_completed = value;
    if (value) {
      this.report_interval_minutes = undefined;
      this.stop_sending_at_time = undefined;
    }
  }
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  JoinColumn,
  Check,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { WeeklyPromotion } from 'src/campaign_config/weekly_promotion';
import { ThreeDayPromotion } from 'src/campaign_config/three_day_promotion';
import { DailyPromotion } from 'src/campaign_config/daily_promotion';

@Entity('campaign_schedules')
@Check(
  `"end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date"`,
)
export class CampaignSchedule {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @OneToOne(() => Campaign, { nullable: false })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column({ type: 'json' })
  schedule_config: DailyPromotion | WeeklyPromotion | ThreeDayPromotion;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'datetime', nullable: true })
  start_date?: string;

  @Column({ type: 'datetime', nullable: true })
  end_date?: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

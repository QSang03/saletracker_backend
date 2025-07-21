import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { PromoMessageFlow } from 'src/campaign_config/promo_message';

@Entity('campaign_contents')
export class CampaignContent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @OneToOne(() => Campaign, { nullable: false })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @Column({ type: 'json', nullable: false })
  messages: PromoMessageFlow;
}

import { Entity, PrimaryColumn, ManyToOne, JoinColumn, Column, CreateDateColumn } from 'typeorm';
import { Campaign } from '../campaigns/campaign.entity';
import { CampaignCustomer } from '../campaign_customers/campaign_customer.entity';

@Entity('campaign_customer_map')
export class CampaignCustomerMap {
  @PrimaryColumn('bigint')
  campaign_id: number;

  @PrimaryColumn('bigint')
  customer_id: number;

  @CreateDateColumn({ name: 'added_at' })
  added_at: Date;

  @ManyToOne(() => Campaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @ManyToOne(() => CampaignCustomer, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_customer_id' })
  campaign_customer: CampaignCustomer;
}

import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, UpdateDateColumn } from 'typeorm';

@Entity('campaign_customers')
export class CampaignCustomer {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  phone_number: string;

  @Index()
  @CreateDateColumn()
  created_at: Date;

  @Index()
  @UpdateDateColumn()
  updated_at: Date;
}

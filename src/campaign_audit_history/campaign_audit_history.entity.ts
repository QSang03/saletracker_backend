import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('campaign_audit_history')
export class CampaignAuditHistory {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  table_name: string;

  @Column({ type: 'json', nullable: true })
  row_identifier?: Record<string, any>;

  @Column({ type: 'json', nullable: true })
  old_data?: Record<string, any>;

  @Column({ type: 'json', nullable: true })
  new_data?: Record<string, any>;

  @Column({ type: 'varchar', length: 20 })
  operation_type: string;

  @Column({ type: 'bigint', nullable: true })
  changed_by_user_id?: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'changed_by_user_id' })
  changed_by_user?: User;

  @CreateDateColumn({ type: 'datetime' })
  changed_at: Date;
}
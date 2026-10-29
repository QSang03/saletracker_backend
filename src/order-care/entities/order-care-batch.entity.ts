import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderCareItem } from './order-care-item.entity';

export enum OrderCareBatchStatus {
  SENDING = 'sending',
  SENT = 'sent',
  FAILED = 'failed',
  RECORD_FAILED = 'record_failed',
}

export enum OrderCareCustomerType {
  GROUP = 'group',
  PRIVATE = 'private',
}

@Entity('order_care_batches')
@Index('idx_order_care_batches_user_created', ['user_id', 'created_at'])
@Index('idx_order_care_batches_source', ['source_message_id'])
export class OrderCareBatch {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  request_id: string;

  @Column('int', { nullable: true })
  user_id: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  user_name_snapshot: string | null;

  @Column({ type: 'varchar', length: 255 })
  source_message_id: string;

  @Column({ type: 'varchar', length: 255 })
  zalo_customer_id: string;

  @Column({
    type: 'enum',
    enum: OrderCareCustomerType,
    default: OrderCareCustomerType.PRIVATE,
  })
  customer_type: OrderCareCustomerType;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', nullable: true })
  content_sent: string | null;

  @Column('bigint', { nullable: true })
  preset_id: number | null;

  @Column({
    type: 'enum',
    enum: OrderCareBatchStatus,
    default: OrderCareBatchStatus.SENDING,
  })
  status: OrderCareBatchStatus;

  @Column('int', { default: 0 })
  order_count: number;

  @Column({ type: 'timestamp', precision: 3, nullable: true })
  sent_at: Date | null;

  @Column('bigint', { nullable: true })
  send_history_id: number | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @OneToMany(() => OrderCareItem, (item) => item.batch)
  items: OrderCareItem[];

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at: Date;
}

import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OrderCareBatch } from './order-care-batch.entity';

@Entity('order_care_items')
@Index('idx_order_care_items_detail_cared', ['order_detail_id', 'cared_at'])
@Index('uq_order_care_items_batch_detail', ['batch_id', 'order_detail_id'], {
  unique: true,
})
// Covering index cho thống kê chăm sóc: lọc cared_at trong kỳ, đọc order_detail_id/batch_id từ index.
@Index('idx_order_care_items_cared', [
  'cared_at',
  'order_detail_id',
  'batch_id',
])
export class OrderCareItem {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column('bigint')
  batch_id: number;

  @ManyToOne(() => OrderCareBatch, (batch) => batch.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'batch_id' })
  batch: OrderCareBatch;

  @Index()
  @Column('bigint')
  order_detail_id: number;

  @Column('bigint', { nullable: true })
  order_id: number | null;

  @Column({ type: 'varchar', length: 20 })
  status_before: string;

  @Column({ type: 'varchar', length: 20 })
  status_after: string;

  @Column('int', { default: 0 })
  care_count_before: number;

  @Column('int', { default: 0 })
  care_count_after: number;

  @Column({ type: 'timestamp', precision: 3 })
  cared_at: Date;
}

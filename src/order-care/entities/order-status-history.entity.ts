import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('order_status_histories')
@Index('idx_order_status_histories_detail_changed', [
  'order_detail_id',
  'changed_at',
])
@Index('idx_order_status_histories_to_changed', ['to_status', 'changed_at'])
@Index('idx_order_status_histories_changed_by', ['changed_by', 'changed_at'])
export class OrderStatusHistory {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Index()
  @Column('bigint')
  order_detail_id: number;

  @Column('bigint', { nullable: true })
  order_id: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  from_status: string | null;

  @Column({ type: 'varchar', length: 20 })
  to_status: string;

  @Column('int', { nullable: true })
  changed_by: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  changed_by_name: string | null;

  @Column({ type: 'varchar', length: 30, default: 'system' })
  source: string;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column('bigint', { nullable: true })
  care_batch_id: number | null;

  @Column({
    name: 'changed_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  changed_at: Date;
}

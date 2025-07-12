import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

export enum OrderStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  DEMAND = 'demand',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column('longtext')
  raw_item: string;

  @Column('json', { nullable: true })
  product_ids: any;

  @Column('int', { default: 1 })
  quantity: number;

  @Column('bigint', { nullable: false })
  conversation_id: number;

  @Column('bigint', { unsigned: true, default: 0 })
  price: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_request_summary: string;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @Column('json', { nullable: true })
  associated_message_ids: any;

  @Column('json', { nullable: true })
  order_history: any;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'sale_by' })
  sale_by: User;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deleted_at: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { Product } from '../products/product.entity';
import { Order } from '../orders/order.entity';
export enum OrderDetailStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  DEMAND = 'demand',
  QUOTED = 'quoted',
  CONFIRMED = 'confirmed',
}
export enum ExtendReason {
  SYSTEM_SUNDAY_AUTO = 'hệ thống tự gia hạn vào chủ nhật hoặc nghỉ lễ',
  USER_MANUAL = 'chính chủ gia hạn',
}
@Entity('order_details')
export class OrderDetail {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @ManyToOne(() => Order, (order) => order.details, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column('bigint', { nullable: false })
  order_id: number;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({
    type: 'enum',
    enum: OrderDetailStatus,
    default: OrderDetailStatus.PENDING,
  })
  status: OrderDetailStatus;

  @Column('bigint', { nullable: true })
  product_id: number;

  @Column('int', { default: 1 })
  quantity: number;

  @Column('int', { default: 4 })
  extended: number;

   @Column('timestamp', { nullable: true, default: null })
  last_extended_at: Date;

  @Column({
    type: 'enum',
    enum: ExtendReason,
    nullable: true,
    default: null,
  })
  extend_reason: ExtendReason;

  @Column('bigint', { unsigned: true, default: 0 })
  unit_price: number;

  @Column({ type: 'longtext', nullable: true })
  customer_request_summary: string;

  @Column('longtext', { nullable: true })
  raw_item: string;

  @Column('longtext', { nullable: true })
  notes: string;

  @Column('longtext', { nullable: true })
  reason: string;

  @Column('varchar', { nullable: true })
  customer_name: string;

  @Column('varchar', {
    name: 'zaloMessageId',
    length: 255,
    nullable: true,
    default: null,
  })
  zaloMessageId: string;

  @Column('json', { nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deleted_at: Date;

  @Column('timestamp', { nullable: true })
  hidden_at: Date | null;
}

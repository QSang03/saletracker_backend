import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, OneToMany } from 'typeorm';
import { User } from '../users/user.entity';
import { OrderDetail } from '../order-details/order-detail.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column('bigint', { nullable: false })
  conversation_id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_request_summary: string;

  @Column('json', { nullable: true })
  order_history: any;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'sale_by' })
  sale_by: User;

  @Column('json', { nullable: true })
  associated_message_ids: any;

  @OneToMany(() => OrderDetail, (orderDetail) => orderDetail.order, { cascade: true })
  details: OrderDetail[];

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deleted_at: Date;
}

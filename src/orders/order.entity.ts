import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';
import { OrderDetail } from '../order-details/order-detail.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Index()
  @Column('bigint', { nullable: false })
  conversation_id: number;

  @Column('json', { nullable: true })
  order_history: any;

  @Index()
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'sale_by' })
  sale_by: User;

  @Column('json', { nullable: true })
  associated_message_ids: any;

  @OneToMany(() => OrderDetail, (orderDetail) => orderDetail.order, {
    cascade: true,
  })
  details: OrderDetail[];

  @Index()
  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at: Date;
}

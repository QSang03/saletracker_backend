import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { OrderDetail } from '../order-details/order-detail.entity';

@Entity('order_inquiry_presets')
export class OrderInquiryPreset {
  @PrimaryGeneratedColumn('increment')
  id: number;

  @Column({ type: 'varchar', length: 255 })
  title: string; // tên preset

  @Column({ type: 'text', nullable: true })
  content?: string; // nội dung câu hỏi thăm sản phẩm

  // Quan hệ với User: 1 user có thể có nhiều presets
  @ManyToOne(() => User, (user) => user.orderInquiryPresets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column('bigint')
  user_id: number;

  // Quan hệ với OrderDetail: nhiều order_detail có thể tham chiếu preset này
  @OneToMany(() => OrderDetail, (orderDetail) => orderDetail.inquiryPreset)
  orderDetails: OrderDetail[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
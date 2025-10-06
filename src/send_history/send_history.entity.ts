import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from 'src/users/user.entity';

@Entity('send_history')
export class SendHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', comment: 'Nội dung tin nhắn được gửi' })
  content: string;

  @Column({ type: 'timestamp', comment: 'Ngày giờ gửi tin nhắn' })
  sent_at: Date;

  @Column({ type: 'varchar', length: 255, comment: 'Người/Hệ thống gửi tin nhắn' })
  sent_from: string;

  @Column({ type: 'varchar', length: 255, comment: 'Người nhận tin nhắn' })
  sent_to: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'zalo_customer_id', comment: 'Zalo customer id của người nhận' })
  zaloCustomerId?: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    name: 'send_function',
    comment: "Phân loại hàm/loại gửi (ví dụ: auto_greeting, manual, scheduled, ...)",
  })
  sendFunction?: string;

  @Column({ type: 'text', nullable: true, comment: 'Ghi chú thêm về việc gửi' })
  notes?: string;

  @CreateDateColumn({ comment: 'Ngày tạo bản ghi' })
  created_at: Date;

  @UpdateDateColumn({ comment: 'Ngày cập nhật bản ghi' })
  updated_at: Date;
}
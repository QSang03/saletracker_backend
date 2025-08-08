import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('order_blacklist')
@Index(['userId', 'zaloContactId'], { unique: true })
@Index(['userId'])
@Index(['zaloContactId'])
export class OrderBlacklist {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({
    name: 'user_id',
    type: 'bigint',
    comment: 'ID của user bị chặn xem order',
  })
  userId: number;

  @ManyToOne(() => User, {
    eager: false,
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    name: 'zalo_contact_id',
    type: 'varchar',
    length: 255,
    comment: 'Zalo contact ID từ order_details.metadata.customer_id',
  })
  zaloContactId: string;

  @Column({
    type: 'longtext',
    nullable: true,
    comment: 'Lý do thêm vào blacklist',
  })
  reason?: string;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at: Date;
}

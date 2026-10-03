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

/**
 * Hoạt động nhắn tin của sale trong/ngoài khung giờ làm việc.
 *
 * Tách khỏi sale_response_intervals vì đây là câu hỏi khác hẳn: không phải
 * "phản hồi khách nhanh bao lâu" mà là "ai làm thêm ngoài giờ, bao nhiêu".
 * Không cần khách, không cần hội thoại — chỉ cần đếm tin của chính sale đó,
 * đã loại trừ tin của bot/auto-reply/auto-greeting/nhắc nợ/campaign.
 *
 * Đây là bảng aggregate: chi tiết từng tin vẫn nằm trong zalo_messages và bị
 * archive sau 30 ngày, nên drill-down quá khứ xa sẽ không còn dữ liệu.
 */
@Entity('sale_work_activity_daily')
@Index(['userId', 'stat_date'], { unique: true })
@Index(['stat_date'])
export class SaleWorkActivityDaily {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Index()
  @Column({ type: 'bigint', comment: 'ID sale' })
  user_id: number;

  @ManyToOne(() => User, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ type: 'bigint', nullable: true })
  department_id: number | null;

  @Index()
  @Column({ type: 'date' })
  stat_date: string;

  @Column({ type: 'int', default: 0, comment: 'Số tin gửi trong khung giờ làm việc' })
  in_hours_msg_count: number;

  @Column({ type: 'int', default: 0, comment: 'Số tin gửi ngoài khung giờ làm việc' })
  out_of_hours_msg_count: number;

  @Column({ type: 'datetime', nullable: true, comment: 'Tin đầu tiên ngoài giờ' })
  out_of_hours_first_at: Date | null;

  @Column({ type: 'datetime', nullable: true, comment: 'Tin cuối cùng ngoài giờ' })
  out_of_hours_last_at: Date | null;

  @Column({
    type: 'int',
    nullable: true,
    comment: 'Khoảng cách giữa tin đầu và tin cuối ngoài giờ (phút)',
  })
  out_of_hours_span_minutes: number | null;

  @Column({
    type: 'boolean',
    default: false,
    comment: 'Có nhắn ngoài giờ không — tiện cho bộ lọc "ai làm thêm"',
  })
  has_out_of_hours: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at: Date;
}

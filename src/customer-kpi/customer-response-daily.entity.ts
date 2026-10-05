import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CustomerAssignment } from './customer-assignment.entity';

/**
 * Tổng hợp phản hồi theo ngày, liên kết dữ liệu sale_response_intervals vào
 * khách hàng phân công. Job Python đọc sale_response_intervals, join sang
 * customer_zalo theo (zalo_contact_id + user_id) rồi ghi tổng hợp vào đây.
 *
 * KHÔNG dùng làm nguồn cho tiêu chí KPI (bảng này chỉ ghi nhận khi khách nhắn
 * trước trong giờ làm việc) — chỉ dùng hiển thị chi tiết trên màn hình khách.
 */
@Entity('customer_response_daily')
@Index('uq_customer_response_assignment_date', ['assignment_id', 'stat_date'], {
  unique: true,
})
@Index('idx_customer_response_stat_date', ['stat_date'])
export class CustomerResponseDaily {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ type: 'int' })
  assignment_id: number;

  @ManyToOne(() => CustomerAssignment, { nullable: false })
  @JoinColumn({ name: 'assignment_id' })
  assignment: CustomerAssignment;

  @Column({ type: 'date' })
  stat_date: string;

  /** Tổng số khoảng chờ = số lần khách nhắn trong giờ làm việc. */
  @Column({ type: 'int', default: 0 })
  total_intervals: number;

  /** Sale đã phản hồi trước khi quá hạn. */
  @Column({ type: 'int', default: 0 })
  responded_count: number;

  /** Quá số ngày cho phép mà sale không phản hồi. */
  @Column({ type: 'int', default: 0 })
  no_reply_count: number;

  /** Thời gian phản hồi trung bình (giây, đã tính trong giờ làm việc). */
  @Column({ type: 'int', nullable: true })
  avg_seconds: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

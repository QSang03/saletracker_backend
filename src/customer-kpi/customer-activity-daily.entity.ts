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
 * Hoạt động theo ngày của MỘT quan hệ Sale–khách (một dòng phân công).
 * Cron Python ghi (rollup mỗi đêm, tính lại 7 ngày gần nhất để tự lành dữ liệu
 * đến trễ), NestJS chỉ đọc để chấm điểm — theo đúng tiền lệ sale-response.
 *
 * Ý nghĩa các cột đếm (nguồn zalo_messages, DB zalo_automation):
 * - inbound_count  : tin KHÁCH nhắn   (is_outgoing = 0)
 * - outbound_count : tin SALE nhắn    (is_outgoing = 1)
 * - order_count / revenue : đơn hàng gắn với khách (meta_customer_id)
 */
@Entity('customer_activity_daily')
@Index('uq_customer_activity_assignment_date', ['assignment_id', 'stat_date'], {
  unique: true,
})
@Index('idx_customer_activity_stat_date', ['stat_date'])
export class CustomerActivityDaily {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  assignment_id: number;

  @ManyToOne(() => CustomerAssignment, { nullable: false })
  @JoinColumn({ name: 'assignment_id' })
  assignment: CustomerAssignment;

  @Column({ type: 'date' })
  stat_date: string;

  @Column({ type: 'int', default: 0 })
  inbound_count: number;

  @Column({ type: 'int', default: 0 })
  outbound_count: number;

  @Column({ type: 'int', default: 0 })
  order_count: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  revenue: number;

  /**
   * false = ngày đó không đo được dữ liệu Zalo (sale offline, chưa khớp
   * tài khoản...) → báo cáo hiện trạng thái "thiếu dữ liệu" và KHÔNG tính
   * vào mẫu số của các tiêu chí dạng ratio.
   */
  @Column({ type: 'boolean', default: false })
  zalo_linked: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApprovalRequest } from './approval-request.entity';

/**
 * Một dòng chỉ tiêu trong đề xuất của trưởng phòng chờ quản trị viên duyệt.
 * Khi duyệt, hệ thống ghi các dòng này vào kpi_targets
 * (customer_id null → quy về 0 = chỉ tiêu cả danh sách).
 */
@Entity('approval_request_target_items')
@Index('idx_arti_request', ['request'])
export class ApprovalRequestTargetItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  request_id: number;

  @ManyToOne(() => ApprovalRequest, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request: ApprovalRequest;

  /** kpi_definitions.criterion_key, ví dụ `doanh_so_key`. */
  @Column({ type: 'varchar', length: 64 })
  criterion_key: string;

  /** Định dạng `YYYY-MM`. */
  @Column({ type: 'varchar', length: 7 })
  period_month: string;

  /** users.id của sale bị tác động. */
  @Column({ type: 'int' })
  sale_id: number;

  /** null = chỉ tiêu cả danh sách; >0 = customers.id (khi duyệt quy về 0). */
  @Column({ type: 'int', nullable: true })
  customer_id: number | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  old_target_value: number | null;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  new_target_value: number | null;

  @CreateDateColumn()
  created_at: Date;
}

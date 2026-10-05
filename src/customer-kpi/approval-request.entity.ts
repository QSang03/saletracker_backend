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
import { User } from '../users/user.entity';

export enum ApprovalRequestType {
  /** Đề xuất sửa danh sách khách hàng (nhân viên → trưởng phòng duyệt). */
  CUSTOMER_LIST = 'customer_list',
  /** Đề xuất chỉ tiêu (trưởng phòng → quản trị viên duyệt). */
  KPI_TARGET = 'kpi_target',
}

export enum ApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * Đề xuất thay đổi chờ duyệt — dùng chung cho HAI luồng (sửa danh sách khách
 * hàng và giao chỉ tiêu) nhưng tách riêng khỏi cơ chế import file, vì người
 * đề xuất và người duyệt khác nhau:
 *
 * | Loại đề xuất        | Người đề xuất   | Người duyệt    |
 * |---------------------|-----------------|----------------|
 * | customer_list       | Nhân viên KD    | Trưởng phòng   |
 * | kpi_target          | Trưởng phòng    | Quản trị viên  |
 * | admin tự nhập       | —               | Áp dụng thẳng  |
 */
@Entity('approval_requests')
@Index('idx_approval_requests_status', ['status', 'request_type'])
export class ApprovalRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: ApprovalRequestType })
  request_type: ApprovalRequestType;

  /** Người gửi đề xuất. */
  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'requested_by' })
  requested_by: User;

  /** Đối tượng bị tác động (sale mà danh sách/chỉ tiêu thuộc về). */
  @Column({ type: 'int', nullable: true, comment: 'users.id của sale bị tác động' })
  target_user_id: number | null;

  @Column({ type: 'enum', enum: ApprovalStatus, default: ApprovalStatus.PENDING })
  status: ApprovalStatus;

  /** Lời nhắn của người đề xuất. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'datetime', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'text', nullable: true })
  reject_reason: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

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
import { KpiSlaViolation } from './kpi-sla-violation.entity';

export enum KpiAppealStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * Khiếu nại một vi phạm SLA 2h cụ thể (Sprint 5).
 *
 * Chỉ dùng cho `sla_phan_hoi_2h`: sale chọn đúng một dòng trong
 * `kpi_sla_violations`, nhập giải trình/evidence. Nếu duyệt, vi phạm được đánh
 * `is_waived=1` và không còn tính vào KPI tháng.
 */
@Entity('kpi_appeals')
@Index('idx_kpi_appeal_sale_period', ['sale_id', 'period'])
@Index('idx_kpi_appeal_status', ['status'])
@Index('idx_kpi_appeal_violation', ['violation_id'])
export class KpiAppeal {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  sale_id: number;

  @Column({ type: 'varchar', length: 64 })
  customer_code: string;

  @Column({ type: 'bigint' })
  violation_id: number;

  @ManyToOne(() => KpiSlaViolation, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'violation_id' })
  violation: KpiSlaViolation;

  @Column({ type: 'varchar', length: 50, default: 'sla_phan_hoi_2h' })
  metric_code: string;

  @Column({ type: 'char', length: 7 })
  period: string;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'json', nullable: true })
  evidence_urls: string[] | null;

  @Column({
    type: 'enum',
    enum: KpiAppealStatus,
    default: KpiAppealStatus.PENDING,
  })
  status: KpiAppealStatus;

  @Column({ type: 'int', nullable: true })
  reviewer_id: number | null;

  @Column({ type: 'text', nullable: true })
  review_note: string | null;

  @Column({ type: 'datetime', nullable: true })
  reviewed_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

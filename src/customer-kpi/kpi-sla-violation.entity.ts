import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { KpiSlaResponseType } from './kpi-sla-interval.entity';

/** Nguồn miễn vi phạm: duyệt khiếu nại hay admin hủy thủ công. */
export enum KpiSlaWaiveSource {
  APPEAL = 'appeal',
  ADMIN = 'admin',
}

/**
 * Sự kiện vi phạm SLA 2 giờ — nguồn để chấm tiêu chí `sla_phan_hoi_2h`.
 *
 * Mỗi lượt chờ quá hạn = 1 dòng. Khi sale phản hồi muộn, dòng được cập nhật
 * `responded_time`/`response_type` nhưng vẫn giữ vi phạm. `is_waived=1` khi
 * khiếu nại được duyệt (Sprint 5).
 */
@Entity('kpi_sla_violations')
@Index('uq_kpi_sla_violation_inbound', ['first_inbound_message_id'], {
  unique: true,
})
@Index('idx_kpi_sla_violation_sale_period', ['sale_id', 'period'])
@Index('idx_kpi_sla_violation_customer', ['customer_code'])
export class KpiSlaViolation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'int' })
  sale_id: number;

  @Column({ type: 'varchar', length: 64 })
  customer_code: string;

  @Column({ type: 'bigint', nullable: true })
  conversation_id: number | null;

  @Column({ type: 'bigint' })
  first_inbound_message_id: number;

  @Column({ type: 'datetime' })
  inbound_time: Date;

  @Column({ type: 'datetime' })
  sla_deadline: Date;

  @Column({ type: 'datetime', nullable: true })
  responded_time: Date | null;

  @Column({
    type: 'enum',
    enum: KpiSlaResponseType,
    default: KpiSlaResponseType.NONE,
  })
  response_type: KpiSlaResponseType;

  @Column({ type: 'int', default: 1 })
  inbound_message_count: number;

  /** `YYYY-MM` của inbound_time. */
  @Column({ type: 'char', length: 7 })
  period: string;

  @Column({ type: 'boolean', default: false })
  is_waived: boolean;

  /** Người miễn vi phạm: reviewer duyệt khiếu nại hoặc admin hủy thủ công. */
  @Column({ type: 'int', nullable: true })
  waived_by: number | null;

  @Column({
    type: 'enum',
    enum: KpiSlaWaiveSource,
    nullable: true,
  })
  waive_source: KpiSlaWaiveSource | null;

  /** Lý do miễn — bắt buộc khi admin hủy thủ công để có dấu vết. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  waive_reason: string | null;

  @Column({ type: 'datetime', nullable: true })
  waived_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

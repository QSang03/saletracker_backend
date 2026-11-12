import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Trạng thái một "lượt chờ" SLA 2 giờ của KPI customer.
 *
 * Đây là bảng nội bộ do Python ghi, NestJS không đọc trực tiếp. Tách khỏi
 * `sale_response_intervals` vì rule khác hẳn:
 *   - KPI customer: thứ 2–7, 08:00–23:00, tính xuyên trưa, bỏ ngày lễ;
 *   - sale_response chuẩn: giờ hành chính, trừ trưa, bỏ tin ngoài giờ.
 *
 * `first_reply_message_id IS NULL` = lượt còn mở. Một hội thoại chỉ có tối đa
 * một lượt mở; tin khách tiếp theo trong lúc mở chỉ tăng `inbound_message_count`.
 */
export enum KpiSlaIntervalStatus {
  PENDING = 'pending',
  RESPONDED = 'responded',
  VIOLATED = 'violated',
}

export enum KpiSlaResponseType {
  MESSAGE = 'message',
  CALL = 'call',
  NONE = 'none',
}

@Entity('kpi_sla_intervals')
@Index('uq_kpi_sla_interval_inbound', ['first_inbound_message_id'], {
  unique: true,
})
@Index('idx_kpi_sla_interval_conv_status', ['conversation_id', 'status'])
@Index('idx_kpi_sla_interval_inbound_time', ['inbound_time'])
@Index('idx_kpi_sla_interval_period', ['period'])
export class KpiSlaInterval {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ type: 'bigint' })
  conversation_id: number;

  @Column({ type: 'int' })
  sale_id: number;

  @Column({ type: 'varchar', length: 64 })
  customer_code: string;

  /** zalo_messages.id của tin khách mở lượt — khóa chống trùng. */
  @Column({ type: 'bigint' })
  first_inbound_message_id: number;

  @Column({ type: 'datetime' })
  inbound_time: Date;

  /** Thời điểm đồng hồ 2h bắt đầu chạy (đã nhảy qua blackout/ngày nghỉ). */
  @Column({ type: 'datetime' })
  sla_started_at: Date;

  @Column({ type: 'datetime' })
  sla_deadline: Date;

  @Column({ type: 'datetime' })
  last_inbound_time: Date;

  @Column({ type: 'int', default: 1 })
  inbound_message_count: number;

  @Column({ type: 'bigint', nullable: true })
  first_reply_message_id: number | null;

  @Column({ type: 'datetime', nullable: true })
  responded_time: Date | null;

  @Column({
    type: 'enum',
    enum: KpiSlaResponseType,
    default: KpiSlaResponseType.NONE,
  })
  response_type: KpiSlaResponseType;

  @Column({
    type: 'enum',
    enum: KpiSlaIntervalStatus,
    default: KpiSlaIntervalStatus.PENDING,
  })
  status: KpiSlaIntervalStatus;

  /** `YYYY-MM` của inbound_time — dùng để chốt tháng. */
  @Column({ type: 'char', length: 7 })
  period: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

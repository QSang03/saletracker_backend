import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Historical message archive only. No current writer and no KPI consumer.
 * Retained as data history; all visit scoring uses customer_appointments.
 */
@Entity('customer_movement_reports')
@Index('idx_customer_movement_user_code', [
  'user_id',
  'customer_code',
  'sent_at',
])
@Index('idx_customer_movement_sent_at', ['sent_at'])
export class CustomerMovementReport {
  @PrimaryGeneratedColumn()
  id: number;

  /** Sale gửi tin = zalo_accounts.user_id (DB zalo_automation). */
  @Column({ type: 'int' })
  user_id: number;

  /** Mã khách viết trong tin (như đã gửi) — NestJS chuẩn hoá khi khớp. */
  @Column({ type: 'varchar', length: 64 })
  customer_code: string;

  @Column({ type: 'datetime' })
  sent_at: Date;

  /** `group` | `personal` — chỉ để tham khảo, KHÔNG lọc theo trường này. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  source_type: string | null;

  /** Nội dung gốc của tin — để đối chiếu khi sale/khách tranh cãi. */
  @Column({ type: 'text', nullable: true })
  raw_text: string | null;

  /** id tin trong zalo_messages — upsert theo đây để chạy lại job không nhân bản. */
  @Column({ type: 'bigint', nullable: true, unique: true })
  source_message_id: number | null;

  @CreateDateColumn()
  created_at: Date;
}

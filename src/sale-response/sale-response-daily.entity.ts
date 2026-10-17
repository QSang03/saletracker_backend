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
 * Tổng hợp theo sale/ngày, phục vụ dashboard. Nguồn sự thật vẫn là
 * sale_response_intervals — bảng này chỉ để đọc nhanh, có thể xoá và
 * rollup lại bất cứ lúc nào.
 *
 * Lưu ý khi đọc: connection đang đặt dateStrings: true nên `stat_date` về tới
 * service dưới dạng string 'YYYY-MM-DD' chứ không phải Date.
 */
@Entity('sale_response_daily')
// KHÔNG khai thêm @Index(['stat_date']) ở đây: nó trùng tên với @Index() trên
// property stat_date (custom naming strategy sinh idx_<table>_stat_date) làm
// MySQL báo "Duplicate key name" khi tạo bảng mới (dev có bảng sẵn nên không lộ).
@Index(['user_id', 'stat_date'], { unique: true })
export class SaleResponseDaily {
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

  @Column({ type: 'int', default: 0, comment: 'Tổng khoảng chờ trong ngày' })
  total_intervals: number;

  @Column({ type: 'int', default: 0 })
  responded_count: number;

  @Column({
    type: 'int',
    default: 0,
    comment: 'Khoảng quá hạn không phản hồi — tính vào tỷ lệ không phản hồi, KHÔNG vào mẫu số p50/p90',
  })
  no_reply_count: number;

  @Column({
    type: 'int',
    default: 0,
    comment: 'Khoảng còn mở tính tới lúc rollup',
  })
  pending_count: number;

  @Column({ type: 'int', nullable: true, comment: 'Trung bình (giây)' })
  avg_seconds: number | null;

  @Column({ type: 'int', nullable: true, comment: 'Trung vị (giây)' })
  p50_seconds: number | null;

  @Column({ type: 'int', nullable: true, comment: 'Phân vị 90 (giây)' })
  p90_seconds: number | null;

  @Column({ type: 'int', nullable: true, comment: 'Nhanh nhất (giây)' })
  min_seconds: number | null;

  @Column({ type: 'int', nullable: true, comment: 'Chậm nhất (giây)' })
  max_seconds: number | null;

  @Column({
    type: 'int',
    default: 0,
    comment: 'Số khoảng vượt cap_seconds, bị loại khỏi p50/p90',
  })
  over_cap_count: number;

  @Column({
    type: 'int',
    nullable: true,
    comment: 'Ngưỡng (giây) đã dùng khi rollup, để audit lại sau này',
  })
  cap_seconds: number | null;

  @Column({
    type: 'json',
    nullable: true,
    comment:
      'Số khoảng đã vượt từng mốc SLA, vd {"5m":12,"15m":8,"1h":5}. Khoảng pending dùng now - started_at.',
  })
  sla_breach_counts: Record<string, number> | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at: Date;
}

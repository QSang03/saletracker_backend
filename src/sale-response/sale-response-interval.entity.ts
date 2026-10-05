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
 * Trạng thái một khoảng chờ phản hồi.
 *
 * LƯU Ý: typeorm đang chạy với synchronize: true, đổi giá trị enum sẽ khiến
 * TypeORM dựng lại bảng. Bổ sung giá trị mới thì được, đổi tên/xoá thì không.
 */
export enum ResponseIntervalStatus {
  /** Đang mở, chờ sale phản hồi. */
  PENDING = 'pending',
  /** Sale đã phản hồi, duration_seconds đã chốt. */
  RESPONDED = 'responded',
  /** Quá số ngày cho phép mà sale không phản hồi -> đóng lại, tính là lỗi sale. */
  NO_REPLY = 'no_reply',
}

/**
 * Một khoảng chờ = từ lúc khách nhắn (trong giờ làm việc) tới lúc sale phản hồi
 * đầu tiên. Trong một hội thoại luôn chỉ có tối đa 1 khoảng đang mở tại một thời điểm;
 * các tin khách sau đó trong lúc khoảng còn mở chỉ tăng inbound_message_count.
 *
 * CHỈ TIN NHẮN KHÁCH NHẮN TRONG GIờ LÀM VIỆC mới tạo ra khoảng. Tin nhắn ngoài
 * giờ không tạo bản ghi nào — được tính sang bảng sale_work_activity_daily.
 */
@Entity('sale_response_intervals')
@Index(['user_id', 'started_at'])
@Index(['status', 'started_at'])
// LƯU Ý: property đã đổi tên zaloContactId -> zalo_contact_id, index phải
// theo tên property (zaloContactId làm TypeORM văng lỗi khi build metadata)
@Index(['zalo_contact_id', 'started_at'])
@Index(['first_inbound_message_id'], { unique: true })
export class SaleResponseInterval {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  // zalo_conversations.id, nằm ở database zalo_automation khác nên không
  // khai báo FK được.
  @Index()
  @Column({ type: 'bigint', comment: 'zalo_conversations.id (DB zalo_automation)' })
  conversation_id: number;

  @Column({ type: 'int', nullable: true })
  zalo_account_id: number | null;

  @Index()
  @Column({ type: 'bigint', nullable: true, comment: 'ID sale sở hữu hội thoại' })
  user_id: number | null;

  @ManyToOne(() => User, { eager: false, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index()
  @Column({ type: 'bigint', nullable: true, comment: 'Denormalize để báo cáo theo phòng ban' })
  department_id: number | null;

  @Index()
  @Column({
    type: 'varchar',
    length: 255,
    comment: 'Zalo contact ID của khách — khóa tự nhiên, KHÔNG dùng customer_name',
  })
  zalo_contact_id: string;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'Snapshot tên khách lúc đo, chỉ để hiển thị',
  })
  customer_name: string | null;

  /**
   * UNIQUE để cron chạy lại không sinh bản ghi trùng. Giá trị lấy từ
   * zalo_messages.id của tin khách mở khoảng.
   */
  @Column({ type: 'bigint', comment: 'zalo_messages.id của tin khách mở khoảng' })
  first_inbound_message_id: number;

  @Column({ type: 'bigint', nullable: true })
  first_reply_message_id: number | null;

  @Column({ type: 'int', default: 1, comment: 'Số tin khách đã gộp vào khoảng này' })
  inbound_message_count: number;

  @Index()
  @Column({ type: 'datetime', comment: 'Giờ Zalo ghi nhận tin khách (UTC+7)' })
  started_at: Date;

  @Column({ type: 'datetime', nullable: true })
  ended_at: Date | null;

  @Column({
    type: 'int',
    nullable: true,
    comment: 'Thời gian chờ tính trong giờ làm việc (đã trừ giờ nghỉ) — số để thống kê',
  })
  duration_seconds: number | null;

  @Column({
    type: 'int',
    nullable: true,
    comment: 'Thời gian chờ thực tế, không trừ giờ nghỉ',
  })
  wall_duration_seconds: number | null;

  @Column({
    type: 'boolean',
    default: false,
    comment: 'Sale trả lời sau giờ làm việc cuối -> duration bị cắt, có thể rất nhỏ',
  })
  replied_outside_hours: boolean;

  @Index()
  @Column({
    type: 'enum',
    enum: ResponseIntervalStatus,
    default: ResponseIntervalStatus.PENDING,
  })
  status: ResponseIntervalStatus;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at: Date;
}

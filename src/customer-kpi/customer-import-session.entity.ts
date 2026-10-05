import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum ImportSessionStatus {
  /** Đã đọc file + so khớp xong, chờ người dùng duyệt từng thay đổi. */
  PENDING_REVIEW = 'pending_review',
  /** Đã ghi các thay đổi được chọn vào dữ liệu thật. */
  APPLIED = 'applied',
  /** Người dùng bỏ giữa chừng. */
  CANCELLED = 'cancelled',
  /** Đã ghi nhưng được hoàn tác về trạng thái trước đó. */
  ROLLED_BACK = 'rolled_back',
}

/**
 * Một lần nạp file Excel phân bổ khách hàng.
 * Import KHÔNG ghi thẳng: upload tạo session + danh sách thay đổi
 * (customer_import_changes), người dùng chọn Giữ/Bỏ từng mục rồi mới apply.
 */
@Entity('customer_import_sessions')
@Index('idx_cis_status', ['status'])
export class CustomerImportSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  file_name: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'uploaded_by' })
  uploaded_by: User;

  @Column({
    type: 'enum',
    enum: ImportSessionStatus,
    default: ImportSessionStatus.PENDING_REVIEW,
  })
  status: ImportSessionStatus;

  /** Số thay đổi đề xuất thêm / sửa / xoá (điền sau khi so khớp). */
  @Column({ type: 'int', default: 0 })
  create_count: number;

  @Column({ type: 'int', default: 0 })
  update_count: number;

  @Column({ type: 'int', default: 0 })
  delete_count: number;

  @Column({ type: 'datetime', nullable: true })
  applied_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  rolled_back_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * Loại thao tác mà user thực hiện trên UI.
 * - view: mở/điều hướng tới một menu/màn hình
 * - create/update/delete: thao tác dữ liệu trên màn hình đó
 * - export/import: xuất/nhập dữ liệu
 */
export enum ActivityAction {
  VIEW = 'view',
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  EXPORT = 'export',
  IMPORT = 'import',
  OTHER = 'other',
}

/**
 * Lịch sử thao tác của người dùng trên UI.
 *
 * Mỗi dòng là một lần user thao tác: bấm menu, hoặc thêm/sửa/xoá dữ liệu
 * tại một màn hình cụ thể. Mục đích: khi cần tra cứu "ngày X user Y đã
 * làm gì, có xoá/sửa dữ liệu nào không".
 *
 * Dữ liệu được giữ lại theo retention (mặc định 3 tháng), cấu hình bằng env
 * ACTIVITY_RETENTION_MONTHS — xem ActivityLogCleanupCronjobService.
 */
@Entity('user_activity_logs')
@Index('idx_activity_logs_user_occurred', ['user_id', 'occurred_at'])
@Index('idx_activity_logs_occurred', ['occurred_at'])
@Index('idx_activity_logs_menu_occurred', ['menu_path', 'occurred_at'])
export class ActivityLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int', nullable: true, comment: 'ID người thực hiện' })
  user_id: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Snapshot username lúc ghi log (giữ lại kể cả khi user bị xoá)',
  })
  username_snapshot?: string | null;

  @Column({
    type: 'varchar',
    length: 191,
    nullable: true,
    comment: 'Tên người dùng hiển thị lúc ghi log',
  })
  full_name_snapshot?: string | null;

  @Column({
    type: 'varchar',
    length: 191,
    nullable: true,
    comment: 'Đường dẫn menu, ví dụ /dashboard/manager-order',
  })
  menu_path?: string | null;

  @Column({
    type: 'varchar',
    length: 191,
    nullable: true,
    comment: 'Tên menu tiếng Việt, ví dụ Quản lý đơn hàng',
  })
  menu_title?: string | null;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Nhóm menu, ví dụ Giao dịch',
  })
  menu_group?: string | null;

  @Column({
    type: 'enum',
    enum: ActivityAction,
    default: ActivityAction.VIEW,
    comment: 'Loại thao tác',
  })
  action: ActivityAction;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    comment: 'Bảng nghiệp vụ bị tác động, ví dụ orders',
  })
  entity?: string | null;

  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    comment: 'ID bản ghi bị tác động',
  })
  entity_id?: string | null;

  @Column({
    type: 'json',
    nullable: true,
    comment: 'Danh sách tên field đã thay đổi (chỉ dùng cho action=update)',
  })
  changed_fields?: string[] | null;

  @Column({
    type: 'json',
    nullable: true,
    comment: 'Giá trị cũ trước khi cập nhật',
  })
  old_values?: Record<string, any> | null;

  @Column({
    type: 'json',
    nullable: true,
    comment: 'Giá trị mới sau khi cập nhật',
  })
  new_values?: Record<string, any> | null;

  @Column({
    type: 'varchar',
    length: 500,
    nullable: true,
    comment: 'Mô tả thao tác bằng chữ',
  })
  description?: string | null;

  @Column({
    type: 'varchar',
    length: 45,
    nullable: true,
    comment: 'IP của client',
  })
  ip_address?: string | null;

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    comment: 'User agent của client',
  })
  user_agent?: string | null;

  @Column({
    type: 'datetime',
    precision: 3,
    comment: 'Thời điểm thao tác xảy ra',
  })
  occurred_at: Date;

  @CreateDateColumn({ comment: 'Ngày tạo bản ghi' })
  created_at: Date;

  @UpdateDateColumn({ comment: 'Ngày cập nhật bản ghi' })
  updated_at: Date;
}

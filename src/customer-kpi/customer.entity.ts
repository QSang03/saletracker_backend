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
import { CustomerImportSession } from './customer-import-session.entity';

/**
 * Danh tính khách hàng — DÙNG CHUNG toàn công ty, KHÔNG có sale_id.
 *
 * Hai Sale cùng phục vụ một khách hàng sẽ trỏ về CÙNG MỘT dòng ở bảng này.
 * Phân công theo Sale nằm ở customer_assignments (xem customer-assignment.entity.ts).
 *
 * Trùng mã: trùng cả mã KH lẫn SAP → gộp + cảnh báo; trùng mã nhưng khác SAP
 * → không thể trùng vì customer_code UNIQUE, bản ghi sau bị bắt lỗi ở bước import.
 */
export enum CustomerRole {
  /** Khách hàng chính (nhãn từ cột `LOẠI MÃ` của file Excel). */
  CHINH = 'CHINH',
  /** Khách hàng phụ. */
  PHU = 'PHU',
}

export enum CustomerStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  /** Xoá sau so khớp import — chỉ ẩn khỏi danh sách, không xoá dòng. */
  DELETED = 'deleted',
}

@Entity('customers')
@Index('uq_customers_code', ['customer_code'], { unique: true })
@Index('idx_customers_status', ['status'])
export class Customer {
  @PrimaryGeneratedColumn()
  id: number;

  /** Mã khách hàng (`MÃ KH`), ví dụ `MBA_HNO_TH_THAKRALONE`. Luôn chứa dấu `_`. */
  @Column({ type: 'varchar', length: 64 })
  customer_code: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_name: string | null;

  /** Mã đối tác SAP (`MÃ ĐỐI TÁC SAP`), ví dụ `C29962`. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  sap_code: string | null;

  @Column({ type: 'enum', enum: CustomerRole, nullable: true })
  customer_role: CustomerRole | null;

  /** Hạn mức công nợ (cột `hạn mức`, nguồn sheet CNO). */
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  debt_limit: number | null;

  @Column({ type: 'enum', enum: CustomerStatus, default: CustomerStatus.ACTIVE })
  status: CustomerStatus;

  /** Session import tạo ra dòng này (để truy vết). */
  @ManyToOne(() => CustomerImportSession, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'import_session_id' })
  import_session: CustomerImportSession | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

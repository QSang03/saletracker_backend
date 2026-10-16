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
// Danh tính khách = CẶP (mã, SAP): cùng mã nhưng khác SAP là khách khác nhau
// (thực tế phổ biến trong file — ví dụ HQS_Q03_SR_PHUCHAI với C00375 và C00552).
// sap_code NOT NULL default '' để ràng buộc duy nhất hoạt động đúng khi không có SAP
// (MySQL cho phép lặp vô hạn giá trị NULL trong index UNIQUE).
@Index('uq_customers_code_sap', ['customer_code', 'sap_code'], { unique: true })
@Index('idx_customers_status', ['status'])
export class Customer {
  @PrimaryGeneratedColumn()
  id: number;

  /** Mã khách hàng (`MÃ KH`), ví dụ `MBA_HNO_TH_THAKRALONE`. Luôn chứa dấu `_`. */
  @Column({ type: 'varchar', length: 64 })
  customer_code: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_name: string | null;

  /**
   * Mã đối tác SAP (`MÃ ĐỐI TÁC SAP`), ví dụ `C29962`. THAM GIA UNIQUE cùng
   * customer_code — cùng mã khác SAP là khách khác. Trống = '' (không dùng
   * NULL vì MySQL không coi NULL bằng nhau trong index UNIQUE).
   */
  @Column({ type: 'varchar', length: 32, default: '' })
  sap_code: string;

  @Column({ type: 'enum', enum: CustomerRole, nullable: true })
  customer_role: CustomerRole | null;

  /**
   * Số ngày công nợ (cột `HẠN MỨC` sheet "File Chi Tiết" — đã đối chiếu: khớp
   * cột `Số ngày công nợ` của sheet CNO ẩn, KHÔNG phải hạn mức tiền). Sheet CNO
   * có thêm cột "Hạn mức công nợ" (tiền) nhưng import cố tình không đọc.
   */
  @Column({ type: 'int', nullable: true })
  credit_days: number | null;

  @Column({
    type: 'enum',
    enum: CustomerStatus,
    default: CustomerStatus.ACTIVE,
  })
  status: CustomerStatus;

  /** Session import tạo ra dòng này (để truy vết). */
  @ManyToOne(() => CustomerImportSession, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'import_session_id' })
  import_session: CustomerImportSession | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

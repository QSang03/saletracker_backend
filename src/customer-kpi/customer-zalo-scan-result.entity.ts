import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Kết quả quét gần nhất của job tự khớp Zalo (chạy ở core-python-backend) —
 * Mục 3 cv 1+3.
 *
 * Quy tắc kiến trúc: backend NestJS KHÔNG đọc DB Zalo. Job Python quét liên
 hệ xong BỔ SUNG data vào bảng này (main DB) — mỗi dòng phân công một dòng —
 để `GET /customers/unmatched` suy ra lý do chi tiết mà không cần đụng DB Zalo:
 * `zalo_account_id` NULL  → sale chưa kết nối Zalo
 * `contacts_scanned` = 0  → tài khoản chưa đồng bộ liên hệ nào
 * `code_found` = true     → tên Zalo có chứa mã nhưng chưa liên kết được
 * còn lại                 → chưa có tên Zalo nào chứa mã khách
 * không có dòng           → job chưa quét (chờ vài phút)
 */
@Entity('customer_zalo_scan_results')
@Index('uq_zalo_scan_assignment', ['assignment_id'], { unique: true })
export class CustomerZaloScanResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  assignment_id: number;

  /** Tài khoản Zalo của sale lần quét gần nhất — NULL = sale chưa kết nối. */
  @Column({ type: 'int', nullable: true })
  zalo_account_id: number | null;

  @Column({ type: 'int', default: 0 })
  contacts_scanned: number;

  @Column({ type: 'boolean', default: false })
  code_found: boolean;

  @Column({ type: 'datetime', nullable: true })
  last_scanned_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

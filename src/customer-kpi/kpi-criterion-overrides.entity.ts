import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/** Trạng thái bị ép bởi ghi đè thủ công — hiện chỉ cho ép "chưa đạt". */
export enum ForcedStatus {
  FAIL = 'fail',
}

/**
 * Ghi đè thủ công trạng thái tiêu chí của quản lý (trưởng phòng cùng phòng
 * hoặc admin — KHÔNG qua luồng duyệt như approval_requests). Dùng khi khách
 * báo cáo xấu rằng sale làm không tốt: ép tiêu chí thành "chưa đạt" bất chấp
 * kết quả engine.
 *
 * Ở ngay hai tiêu chí hành vi theo THÁNG (support_khach / lien_lac_phan_hoi).
 * `customer_id = 0` (KHÔNG dùng NULL — MySQL không coi hai NULL bằng nhau trong
 * UNIQUE) = ghi đè CẢ DANH SÁCH của sale, mạnh nhất: toàn bộ tiêu chí của sale
 * trong tháng đó không đạt cho mọi khách. `customer_id > 0` = ghi đè riêng một
 * khách, chỉ hạ ô khách đó và trừ vào x/y đầu bảng cấp sale.
 *
 * Ghi đè chỉ HẠ (pass → fail), không nâng lên. Bảng rollup engine vẫn giữ
 * nguyên số thật — override là lớp đè lúc đọc, xoá override là engine hiện lại.
 */
@Entity('kpi_criterion_overrides')
@Index(
  'uq_kpi_overrides_lookup',
  ['criterion_key', 'period_month', 'sale_id', 'customer_id'],
  { unique: true },
)
@Index('idx_kpi_overrides_sale_month', ['sale_id', 'period_month'])
export class KpiCriterionOverride {
  @PrimaryGeneratedColumn()
  id: number;

  /** kpi_definitions.criterion_key — chỉ nhận 2 key hành vi (validate ở service). */
  @Column({ type: 'varchar', length: 64 })
  criterion_key: string;

  /** Định dạng `YYYY-MM`. */
  @Column({ type: 'varchar', length: 7 })
  period_month: string;

  @Column({ type: 'int' })
  sale_id: number;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'sale_id' })
  sale: User;

  /** 0 = cả danh sách của sale; >0 = customers.id. */
  @Column({
    type: 'int',
    default: 0,
    comment: '0 = cả danh sách; >0 = customers.id',
  })
  customer_id: number;

  @Column({ type: 'enum', enum: ForcedStatus, default: ForcedStatus.FAIL })
  forced_status: ForcedStatus;

  /** Lý do ghi đè — bắt buộc, để truy vết khi bị khiếu nại. */
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

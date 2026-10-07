import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * Chỉ tiêu theo tháng cho tiêu chí dạng ratio ("mỗi người một nước").
 *
 * CHỈ TIÊU LUÔN LƯU Ở CẤP NHÂN VIÊN — "gán theo phòng ban" chỉ là thao tác
 * hàng loạt tạo dòng cho mọi người trong phòng, KHÔNG phải một cấp lưu riêng.
 * Nếu coi chỉ tiêu phòng là bậc áp cho từng khách, chỉ tiêu 500 triệu của
 * phòng sẽ bị nhân với số khách (500tr × 40 = 20 tỷ) — thiết kế mục 5.1.7.
 *
 * Quy tắc chấm: chỉ tiêu riêng khách > chỉ tiêu cấp nhân viên > ngưỡng
 * cố định trong kpi_definitions.
 *
 * LƯU Ý `customer_id = 0` (KHÔNG dùng NULL): MySQL không coi hai NULL là bằng
 * nhau trong index UNIQUE — dùng 0 để ràng buộc duy nhất hoạt động đúng cho
 * dòng "chỉ tiêu cả danh sách". Vì vậy KHÔNG đặt FK sang customers.
 */
@Entity('kpi_targets')
@Index(
  'uq_kpi_targets_lookup',
  ['criterion_key', 'period_month', 'sale_id', 'customer_id'],
  {
    unique: true,
  },
)
@Index('idx_kpi_targets_sale_month', ['sale_id', 'period_month'])
export class KpiTarget {
  @PrimaryGeneratedColumn()
  id: number;

  /** kpi_definitions.criterion_key — chỉ gán cho tiêu chí dạng ratio. */
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

  /** 0 = chỉ tiêu cho CẢ DANH SÁCH của sale; >0 = customers.id. */
  @Column({
    type: 'int',
    default: 0,
    comment: '0 = cả danh sách; >0 = customers.id',
  })
  customer_id: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  target_value: number;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn()
  created_at: Date;
}

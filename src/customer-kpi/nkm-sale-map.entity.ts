import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Bảng tra mã nhân viên NKM ↔ hệ thống.
 *
 * API doanh thu của NKM nhận `slpCode` (số nội bộ NKM) chứ không nhận mã nhân
 * viên, còn API chỉ tiêu quý lại chỉ trả `SlpName` dạng `NKDS33-NGUYỄN CHÍ ĐẠO`
 * — không có slpCode. Bảng này là chỗ duy nhất nối hai đầu lại với nhau, nguồn
 * nạp là file `bang_ma_doiCHieu.xlsx` (script scripts/load-nkm-mapping.mjs).
 *
 * `employee_code` nối sang `users.employee_code`; sale chưa có user (nhân viên
 * mới, nhóm Online) vẫn lưu dòng tra, engine chỉ không hiện KPI cho tới khi tạo
 * user trong hệ.
 */
@Entity('nkm_sale_map')
@Index('uq_nkm_sale_map_slp', ['slp_code'], { unique: true })
@Index('idx_nkm_sale_map_employee', ['employee_code'])
export class NkmSaleMap {
  @PrimaryGeneratedColumn()
  id: number;

  /** `slpCode` trong API NKM — khóa nối sang customer_revenue_daily. */
  @Column({ type: 'int' })
  slp_code: number;

  /** `NKDS33-NGUYỄN CHÍ ĐẠO` — đúng chuỗi API quý trả về để nối chỉ tiêu. */
  @Column({ type: 'varchar', length: 128 })
  sale_label: string;

  /** Mã nhân viên nội bộ, cắt `sale_label` trước dấu `-` đầu tiên: `NKDS33`. */
  @Column({ type: 'varchar', length: 32 })
  employee_code: string;

  /** Phần tên người của `sale_label`: `NGUYỄN CHÍ ĐẠO`. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  sale_name: string | null;

  /** Phòng ban theo bảng phân phối: `KD-LAPTOP`. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  dept_code: string | null;

  /** Slug phòng ban trong hệ: `laptop`. Mặc định theo bảng phân phối §3.1. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  dept_slug: string | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Chỉ tiêu doanh số THEO QUÝ của từng sale — job đồng bộ ghi từ API NKM
 * `get-doanhso-quy-truhangtra` (thiết kế §3.3).
 *
 * Năm tài chính: Q1 = tháng 4-5-6, Q2 = 7-8-9, Q3 = 10-11-12, Q4 = 1-2-3.
 * `fiscal_year` = năm bắt đầu năm tài chính (2026 = 01/04/2026–31/03/2027),
 * đúng tham số `year` của API.
 *
 * MỘT target dùng cho CẢ HAI tiêu chí `doanh_so_key` và `doanh_so_non`
 * (§1.2 của thiết kế) — hai tiêu chí nạp cùng `target_value` của quý.
 *
 * Bảng này do job ghi thẳng, KHÔNG đi qua `/customer-kpi-targets` (chỗ đó chặn
 * nhập tay tiêu chí doanh số) nên không bị ảnh hưởng bởi lệnh chặn.
 */
@Entity('sale_revenue_target')
@Index('uq_sale_revenue_target', ['slp_code', 'fiscal_year', 'quarter'], {
  unique: true,
})
@Index('idx_sale_revenue_target_period', ['fiscal_year', 'quarter'])
export class SaleRevenueTarget {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  slp_code: number;

  /** `NKDS12-NGUYỄN HỮU THỊNH` — lưu kèm để đối chiếu với API quý. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  sale_label: string | null;

  /** Năm bắt đầu năm tài chính (2026 = 01/04/2026–31/03/2027). */
  @Column({ type: 'int' })
  fiscal_year: number;

  /** 1..4 (Q1 = tháng 4-6, Q4 = tháng 1-3). */
  @Column({ type: 'tinyint' })
  quarter: number;

  /** `TargetQ{n}` — chỉ tiêu cả quý. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  target_value: number;

  /** `DatThucTeQ{n}` — thực tế cả quý theo NKM. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  actual_value: number;

  /** `TiLeQ{n}` — thực tế / chỉ tiêu, 6 chữ số thập phân. */
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  ratio: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

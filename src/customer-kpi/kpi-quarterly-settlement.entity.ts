import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Quyết toán KPI quý theo sale.
 *
 * Điều kiện đạt (chốt 12/11/2026):
 *   1. Doanh số quý >= target quý — dùng actual_value của API S1, không tự
 *      phân bổ lại doanh thu khi khách bàn giao.
 *   2. Phủ 100% khách KEY trong quý (union 3 tháng); N_key = 0 thì miễn trừ.
 *
 * Quý không chốt cứng ngay: S1 có thể còn điều chỉnh dữ liệu trong 10 ngày
 * đầu quý sau. Vì vậy settlement có `is_final`:
 *   - 0 = tạm tính, cron recompute hằng ngày trong 10 ngày;
 *   - 1 = admin đã xác nhận chốt; clawback mới có hiệu lực.
 */
export enum KpiQuarterStatus {
  /** Thiếu target / thiếu mapping slpCode / chưa đủ dữ liệu. */
  PENDING_DATA = 'PENDING_DATA',
  PASSED = 'PASSED',
  FAILED_REVENUE = 'FAILED_REVENUE',
  FAILED_KEY_COVERAGE = 'FAILED_KEY_COVERAGE',
  FAILED_BOTH = 'FAILED_BOTH',
  /** Không có khách KEY — chỉ xét doanh số. */
  EXEMPT_NO_KEY = 'EXEMPT_NO_KEY',
}

@Entity('kpi_quarterly_settlements')
@Index('uq_kpi_quarter_sale', ['sale_id', 'fiscal_year', 'quarter'], {
  unique: true,
})
@Index('idx_kpi_quarter_period', ['fiscal_year', 'quarter'])
export class KpiQuarterlySettlement {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  sale_id: number;

  /** Năm bắt đầu năm tài chính (2026 = 01/04/2026–31/03/2027). */
  @Column({ type: 'int' })
  fiscal_year: number;

  /** 1..4 — Q1 = tháng 4-6, Q4 = tháng 1-3. */
  @Column({ type: 'tinyint' })
  quarter: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  target_value: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  actual_revenue: number;

  @Column({ type: 'int', default: 0 })
  n_key: number;

  @Column({ type: 'int', default: 0 })
  covered_key: number;

  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
  key_coverage_rate: number;

  @Column({ type: 'boolean', default: false })
  revenue_achieved: boolean;

  @Column({ type: 'boolean', default: false })
  key_achieved: boolean;

  @Column({
    type: 'enum',
    enum: KpiQuarterStatus,
    default: KpiQuarterStatus.PENDING_DATA,
  })
  status: KpiQuarterStatus;

  /**
   * Tổng tiền thưởng đã tạm tính của tháng 1 + tháng 2 trong quý. Tháng 3
   * quyết toán tại quý, không đưa vào clawback.
   */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  monthly_bonus_total: number;

  /** Số phải thu hồi nếu quý trượt; chỉ có hiệu lực khi is_final = 1. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  clawback_amount: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ type: 'json', nullable: true })
  snapshot: Record<string, any> | null;

  /**
   * 0 = tạm tính trong 10 ngày đầu quý sau; 1 = admin đã chốt.
   * Clawback trước khi final chỉ là số tham khảo.
   */
  @Column({ type: 'boolean', default: false })
  is_final: boolean;

  @Column({ type: 'datetime', nullable: true })
  finalized_at: Date | null;

  @Column({ type: 'int', nullable: true })
  finalized_by: number | null;

  @Column({ type: 'datetime', nullable: true })
  computed_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

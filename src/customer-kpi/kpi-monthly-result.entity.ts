import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Kết quả KPI tháng theo độ phủ khách KEY — snapshot tại thời điểm chốt tháng.
 *
 * Vì sao phải lưu: engine KPI hiện tại chấm lúc đọc. Nếu list khách hoặc doanh
 * thu thay đổi sau khi đã tạm tính thưởng tháng, không có snapshot thì không
 * thể biết tháng đó đã tạm tính bao nhiêu để clawback.
 *
 * Công thức (chốt 12/11/2026):
 *   N_key      = số khách KEY trong customer_assignments của sale
 *   Covered_key= số khách KEY có quantity > 0 trong customer_revenue_daily
 *   Đạt        = Covered_key / N_key >= target_rate (mặc định 60%)
 *   N_key = 0  -> EXEMPT_NO_KEY
 */
export enum KpiMonthlyStatus {
  /** Chưa đủ dữ liệu để chốt (sale chưa map được slpCode...). */
  PENDING = 'PENDING',
  PASSED = 'PASSED',
  FAILED = 'FAILED',
  /** Không có khách KEY nào được giao — miễn trừ tiêu chí độ phủ. */
  EXEMPT_NO_KEY = 'EXEMPT_NO_KEY',
}

@Entity('kpi_monthly_results')
@Index('uq_kpi_monthly_sale_period', ['sale_id', 'period_month'], {
  unique: true,
})
@Index('idx_kpi_monthly_period', ['period_month'])
export class KpiMonthlyResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  sale_id: number;

  /** `YYYY-MM`. */
  @Column({ type: 'char', length: 7 })
  period_month: string;

  @Column({ type: 'int', default: 0 })
  n_key: number;

  @Column({ type: 'int', default: 0 })
  covered_key: number;

  /** Tỷ lệ phủ (%) — 0..100. */
  @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
  coverage_rate: number;

  /** Ngưỡng đạt của tháng (%) — lấy từ config, mặc định 60. */
  @Column({ type: 'decimal', precision: 6, scale: 2, default: 60 })
  target_rate: number;

  @Column({
    type: 'enum',
    enum: KpiMonthlyStatus,
    default: KpiMonthlyStatus.PENDING,
  })
  status: KpiMonthlyStatus;

  /**
   * Tiền thưởng/chăm sóc tạm tính của tháng. Phase 1 nhập tay; công thức động
   * trên UI là TODO (mục 7.4 của kế hoạch).
   */
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  bonus_amount: number | null;

  /**
   * Ảnh chụp dữ liệu lúc chốt: danh sách customer_code KEY, danh sách đã phủ,
   * slpCode dùng để nối doanh thu, nguồn dữ liệu. Dùng để đối soát khi list
   * khách thay đổi giữa quý.
   */
  @Column({ type: 'json', nullable: true })
  snapshot: Record<string, any> | null;

  @Column({ type: 'datetime', nullable: true })
  computed_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

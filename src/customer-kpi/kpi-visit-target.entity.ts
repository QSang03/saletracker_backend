import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Kỳ áp dụng của chỉ tiêu gặp khách. */
export enum KpiVisitTargetPeriod {
  MONTH = 'month',
  QUARTER = 'quarter',
}

/** `count` = số khách; `percent` = % trên tổng khách được giao của sale. */
export enum KpiVisitTargetType {
  COUNT = 'count',
  PERCENT = 'percent',
}

/** Phạm vi khách áp chỉ tiêu — ALL dùng cho tiến độ tổng. */
export enum KpiVisitTargetTier {
  ALL = 'ALL',
  KEY = 'KEY',
  NON = 'NON',
}

/**
 * Chỉ tiêu "gặp khách" theo sale/kỳ.
 *
 * - Kỳ tháng: `period_key = YYYY-MM`.
 * - Kỳ quý: `period_key = YYYY-QN` theo NĂM TÀI CHÍNH (Q1 = 4–6, Q2 = 7–9,
 *   Q3 = 10–12, Q4 = 1–3). Ví dụ Q3/2026 = `2026-Q3`.
 * - `percent`: gán hàng loạt được theo phòng ban; mẫu số là tổng khách được
 *   giao của sale trong phạm vi tier tương ứng.
 * - `count`: bắt buộc cấu hình riêng từng sale.
 *
 * Không FK sang users để tránh ràng buộc khi xoá mềm; tra tên qua userRepo.
 */
@Entity('kpi_visit_targets')
@Index(
  'uq_kpi_visit_target_sale_period_tier',
  ['sale_id', 'period_type', 'period_key', 'customer_tier'],
  { unique: true },
)
@Index('idx_kpi_visit_target_period', ['period_type', 'period_key'])
export class KpiVisitTarget {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  sale_id: number;

  @Column({ type: 'enum', enum: KpiVisitTargetPeriod })
  period_type: KpiVisitTargetPeriod;

  /** `YYYY-MM` hoặc `YYYY-QN` (năm tài chính). */
  @Column({ type: 'varchar', length: 10 })
  period_key: string;

  @Column({ type: 'enum', enum: KpiVisitTargetType })
  target_type: KpiVisitTargetType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  target_value: number;

  @Column({
    type: 'enum',
    enum: KpiVisitTargetTier,
    default: KpiVisitTargetTier.ALL,
  })
  customer_tier: KpiVisitTargetTier;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cách chấm điểm — mỗi tiêu chí chọn MỘT kiểu theo bản chất của nó:
 * - binary: đạt / không đạt (so metric_value với target_value qua `comparison`)
 * - ratio : % đạt được (metric_value / mẫu số theo `denominator`)
 */
export enum ScoringMode {
  BINARY = 'binary',
  RATIO = 'ratio',
}

/** Mẫu số của tiêu chí dạng ratio (thiết kế mục 5.1.5). */
export enum KpiDenominator {
  /** metric / chỉ tiêu được giao — dùng cho doanh số. */
  TARGET_VALUE = 'target_value',
  /** số KH đạt / tổng số KH trong danh sách. */
  ALL_CUSTOMERS = 'all_customers',
  /** số KH đạt / tổng số KH đo được (bỏ qua khách thiếu dữ liệu). */
  REACHABLE_CUSTOMERS = 'reachable_customers',
}

export enum KpiPeriod {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  QUARTER = 'quarter',
}

/** Chỉ dùng khi scoring_mode = binary. */
export enum KpiComparison {
  /** metric >= target là đạt. */
  GTE = 'gte',
  /** metric <= target là đạt. */
  LTE = 'lte',
}

/**
 * Tiêu chí KPI theo NHÓM (team_group). Hiện chỉ nhóm `kinh-doanh`; sau này
 * nhóm Công nợ, Kế toán... có bộ tiêu chí riêng — thêm dòng là xong, không
 * sửa engine.
 *
 * LƯU Ý ĐẶT TÊN CỘT: `key` là từ khoá của MySQL, nên cột trong DB đặt là
 * `criterion_key` (property TS vẫn là `key`). Tránh đau đầu backtick khi
 * Python cron query thẳng bảng này.
 */
@Entity('kpi_definitions')
@Index('uq_kpi_definitions_group_key', ['team_group', 'key'], { unique: true })
@Index('idx_kpi_definitions_lookup', ['team_group', 'is_active', 'sort_order'])
export class KpiDefinition {
  @PrimaryGeneratedColumn()
  id: number;

  /** Nhóm áp dụng: `kinh-doanh` (mặc định), `cong-no`, `ke-toan`... */
  @Column({ type: 'varchar', length: 64, default: 'kinh-doanh' })
  team_group: string;

  @Column({ name: 'criterion_key', type: 'varchar', length: 64 })
  key: string;

  /** Tên hiển thị, ví dụ "Support Khách / Thăm hỏi". */
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Trỏ tới adapter xử lý: contacted_customers, revenue_key... (mục 5.1). */
  @Column({ type: 'varchar', length: 64 })
  metric: string;

  @Column({ type: 'enum', enum: ScoringMode })
  scoring_mode: ScoringMode;

  /** Chỉ dùng khi scoring_mode = ratio. */
  @Column({ type: 'enum', enum: KpiDenominator, nullable: true })
  denominator: KpiDenominator | null;

  @Column({ type: 'enum', enum: KpiPeriod, default: KpiPeriod.DAY })
  period: KpiPeriod;

  /** binary: ngưỡng đạt. ratio + denominator=target_value: chỉ tiêu mặc định. */
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  target_value: number | null;

  /** Chỉ dùng khi scoring_mode = binary. */
  @Column({ type: 'enum', enum: KpiComparison, nullable: true })
  comparison: KpiComparison | null;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

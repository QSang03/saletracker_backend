import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum DebtStatus {
  PAID = 'paid',
  PAY_LATER = 'pay_later',
  NO_INFORMATION = 'no_information_available',
}

@Entity('debt_statistics')
@Index('idx_statistic_date', ['statistic_date'])
@Index('idx_statistic_date_status', ['statistic_date', 'status'])
@Index('idx_customer_code', ['customer_code'])
@Index('idx_statistic_date_customer', ['statistic_date', 'customer_code'])
@Index('idx_status', ['status'])
@Index('idx_employee_code_raw', ['employee_code_raw'])
@Index('idx_due_date', ['due_date'])
// Phase 1.1: Tối ưu hóa index cho debt statistics
@Index('idx_debt_stats_date_status', ['statistic_date', 'status'])
@Index('idx_debt_stats_employee_date', ['employee_code_raw', 'statistic_date'])
@Index('idx_debt_stats_customer_date', ['customer_code', 'statistic_date'])
@Index('idx_debt_stats_due_date', ['due_date', 'status'])
@Index('idx_debt_stats_pay_later', ['pay_later', 'status'])
// @Index('uniq_stat_date_debt', ['statistic_date', 'original_debt_id'], { unique: true })
export class DebtStatistic {
  @PrimaryGeneratedColumn()
  id: number;

  // Ngày thống kê (snapshot date)
  @Column({ type: 'date' })
  statistic_date: Date;

  // Copy tất cả fields từ bảng debts
  @Column({ length: 50 })
  customer_raw_code: string;

  @Column({ length: 50 })
  invoice_code: string;

  @Column({ length: 50 })
  bill_code: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  total_amount: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  remaining: number;

  @Column({ type: 'date', nullable: true })
  issue_date: Date;

  @Column({ type: 'date', nullable: true })
  due_date: Date;

  @Column({ type: 'date', nullable: true })
  pay_later: Date | null;

  @Column({
    type: 'enum',
    enum: DebtStatus,
    default: DebtStatus.NO_INFORMATION,
  })
  status: DebtStatus;

  // Copy thông tin sale tại thời điểm snapshot
  @Column({ type: 'int', nullable: true })
  sale_id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sale_name_raw: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  employee_code_raw: string;

  // Copy thông tin debt_config tại thời điểm snapshot
  @Column({ type: 'int', nullable: true })
  debt_config_id: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  customer_code: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_name: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  customer_type: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({
    type: 'tinyint',
    default: 0,
    comment: '0: chưa thông báo, 1: đã thông báo',
  })
  is_notified: number;

  // Timestamps từ debt gốc
  @Column({ type: 'datetime' })
  original_created_at: Date;

  @Column({ type: 'datetime' })
  original_updated_at: Date;

  // ID của debt gốc để reference
  @Column({ type: 'int' })
  @Index('idx_original_debt_id')
  original_debt_id: number;

  // Timestamps của bản snapshot
  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Virtual getters để compatibility với frontend code hiện tại
  get collectionRate(): number {
    if (this.total_amount === 0) return 0;
    return ((this.total_amount - this.remaining) / this.total_amount) * 100;
  }

  get totalAmount(): number {
    return this.total_amount;
  }

  get paymentAmount(): number {
    return this.total_amount - this.remaining;
  }

  get customerCode(): string {
    return this.customer_code || this.customer_raw_code;
  }

  get customerName(): string {
    return this.customer_name || '';
  }

  get saleName(): string {
    return this.sale_name_raw || '';
  }
}

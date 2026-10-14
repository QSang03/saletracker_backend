import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Chỉ tiêu doanh số cấp NHÓM (phòng ban) theo quý — nhập TAY được, khác với
 * chỉ tiêu cấp sale lấy từ API NKM và bị chặn nhập tay (thiết kế §6.3).
 *
 * Mặc định không có dòng nào: target cấp nhóm = tổng target quý của các sale
 * trong phòng. Có dòng thì dùng dòng này — để trưởng phòng kinh doanh tự ấn
 * định mức cho cả phòng, không bị trói vào cách chia của API.
 */
@Entity('dept_revenue_target')
@Index('uq_dept_revenue_target', ['dept_slug', 'fiscal_year', 'quarter'], {
  unique: true,
})
export class DeptRevenueTarget {
  @PrimaryGeneratedColumn()
  id: number;

  /** Slug phòng ban: may-in | pc | linh-kien | laptop | ptkh1 | ptkh2. */
  @Column({ type: 'varchar', length: 64 })
  dept_slug: string;

  /** Năm bắt đầu năm tài chính (2026 = 01/04/2026–31/03/2027). */
  @Column({ type: 'int' })
  fiscal_year: number;

  /** 1..4 (Q1 = tháng 4-6, Q4 = tháng 1-3). */
  @Column({ type: 'tinyint' })
  quarter: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  target_value: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @Column({ type: 'int', nullable: true })
  created_by: number | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

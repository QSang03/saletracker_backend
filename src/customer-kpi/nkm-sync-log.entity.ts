import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Nhật ký đồng bộ doanh thu THEO NGÀY — ghi một dòng cho mỗi ngày đã chạy,
 * kể cả ngày **không có phiếu nào** (chủ nhật, ngày nghỉ).
 *
 * Vì sao cần bảng này: ngày không có bán hàng thì `customer_revenue_daily`
 * không có dòng nào. Nếu chỉ nhìn vào đó để soi "ngày còn hụt", mọi ngày nghỉ
 * sẽ bị coi là hụt mãi → mỗi đêm cron lại gọi lại 72 lần API cho những ngày
 * đã biết chắc không có số. Nhật ký này phân biệt "chưa chạy" với "đã chạy,
 * hôm đó cả công ty không bán gì".
 */
@Entity('nkm_sync_log')
export class NkmSyncLog {
  @PrimaryGeneratedColumn()
  id: number;

  /** Ngày đã đồng bộ (một dòng/ngày). */
  @Column({ type: 'date', unique: true })
  stat_date: Date;

  /** Số sale đã gọi (72 khi bảng tra mã đầy đủ). */
  @Column({ type: 'int', default: 0 })
  sales: number;

  /** Số dòng khách ghi được (0 = ngày cả công ty không bán gì). */
  @Column({ type: 'int', default: 0 })
  rows: number;

  /** Số sale gọi lỗi — lần chạy sau sẽ gọi lại. */
  @Column({ type: 'int', default: 0 })
  failed: number;

  /** Số liệu của ngày hôm nay (SAP còn nạp dở) chưa chốt. */
  @Column({ type: 'boolean', default: false })
  provisional: boolean;

  @CreateDateColumn()
  created_at: Date;
}

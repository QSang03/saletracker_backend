import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Doanh thu theo NGÀY của từng cặp (khách hàng × sale) — job đồng bộ ghi,
 * engine chỉ đọc. Nguồn chân lý là API NKM `get-doanhthu-theo-doitac`
 * (thiết kế THIET-KE-DOANH-SO-API-NKM.md §3.2).
 *
 * Một dòng = một ngày, một khách, một sale: job gọi API theo từng sale với
 * `from = D` và `to = D` nên mỗi lần gọi trả về đúng một ngày dữ liệu cho toàn
 * bộ khách của sale đó → vừa có doanh số của sale, vừa biết từng khách có
 * PHÁT SINH hay không (cột `quantity`).
 *
 * Doanh số dùng `line_total` (CHƯA VAT) — đã đối chiếu từng đồng với
 * `DatThucTeQn` của API chỉ tiêu quý (§2.2 của thiết kế).
 */
@Entity('customer_revenue_daily')
@Index(
  'uq_revenue_customer_sale_date',
  ['customer_code', 'slp_code', 'stat_date'],
  {
    unique: true,
  },
)
@Index('idx_revenue_sale_date', ['slp_code', 'stat_date'])
@Index('idx_revenue_customer_date', ['customer_code', 'stat_date'])
export class CustomerRevenueDaily {
  @PrimaryGeneratedColumn()
  id: number;

  /** `CardCode` API trả về = `customers.customer_code` (mã khách). */
  @Column({ type: 'varchar', length: 64 })
  customer_code: string;

  /** `slpCode` của sale đã bán — nối sang `nkm_sale_map.slp_code`. */
  @Column({ type: 'int' })
  slp_code: number;

  @Column({ type: 'date' })
  stat_date: Date;

  /** Số phiếu trong ngày — > 0 nghĩa là khách có phát sinh. */
  @Column({ type: 'int', default: 0 })
  quantity: number;

  /** Doanh số CHƯA VAT — cột dùng cho KPI doanh số. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  line_total: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  line_vat: number;

  /** Doanh số CÓ VAT — lưu tham khảo, không dùng chấm KPI. */
  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  g_total: number;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  gross_profit: number;

  /**
   * `CardCode` đã dùng khi gọi API để truy vết. Job đồng bộ theo sale không
   * truyền cardCode nên cột này bằng `customer_code`; giữ lại để đối chiếu các
   * lần gọi theo từng khách.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  card_code: string | null;

  /**
   * Số liệu của NGÀY HÔM NAY — SAP còn nạp dở nên còn nhảy (cùng một URL gọi
   * cách vài phút ra 41 rồi 139 dòng). Báo cáo dùng cột này để hiện nhãn "tạm
   * tính"; job chốt lại mỗi lần đồng bộ trong ngày chạy.
   */
  @Column({ type: 'boolean', default: false })
  is_provisional: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PricingRules } from '../sale-quote.constants';

@Entity('sale_quote_settings')
export class SaleQuoteSetting {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('uq_sale_quote_settings_user', { unique: true })
  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({
    name: 'pricing_rules',
    type: 'json',
    nullable: true,
  })
  pricingRules?: PricingRules | null;

  // LƯU Ý: cột default_warranty đã bị XOÁ — bảo hành chỉ lấy từ dữ liệu
  // import Excel ("MÃ HT"/"TGBH") lưu trên products.warranty_months.

  @Column({
    name: 'default_status_text',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  defaultStatusText?: string | null;

  @Column({
    name: 'price_label',
    type: 'varchar',
    length: 50,
    nullable: true,
    default: 'fv',
  })
  priceLabel?: string | null;

  @Column({ name: 'default_global_note', type: 'text', nullable: true })
  defaultGlobalNote?: string | null;

  @Column({ name: 'zalo_suffix', type: 'text', nullable: true })
  zaloSuffix?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

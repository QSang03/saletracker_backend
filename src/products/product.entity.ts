import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Index,
} from 'typeorm';
import { Category } from '../categories/category.entity';
import { Brand } from '../brands/brand.entity';

@Entity({ name: 'products' })
@Index('idx_products_code', ['productCode'])
@Index('ft_products_name_desc', ['productName', 'description'], {
  fulltext: true,
})
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'product_code', type: 'varchar', length: 255 })
  productCode: string;

  @Column({ name: 'product_name', type: 'text' })
  productName: string;

  @Column({ type: 'longtext', nullable: true })
  description?: string;

  @Column({
    name: 'price',
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (value?: number | null) => value ?? null,
      from: (value?: string | number | null) =>
        value === null || value === undefined ? null : Number(value),
    },
  })
  price?: number | null;

  /**
   * Giá trước lần thay đổi gần nhất — cặp với price_changed_at để giao diện
   * sale thấy "giá đã biến động". Bị ghi đè mỗi lần giá đổi mới.
   */
  @Column({
    name: 'previous_price',
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (value?: number | null) => value ?? null,
      from: (value?: string | number | null) =>
        value === null || value === undefined ? null : Number(value),
    },
  })
  previousPrice?: number | null;

  /** Thời điểm phát hiện giá đổi gần nhất (null = chưa từng đổi giá). */
  @Column({ name: 'price_changed_at', type: 'datetime', nullable: true })
  priceChangedAt?: Date | null;

  /**
   * Thời gian bảo hành theo THÁNG — API nguồn không có thông tin này, chỉ có
   * qua import Excel (cột "MÃ HT" + "TGBH"). Null = chưa nạp bảo hành.
   */
  @Column({ name: 'warranty_months', type: 'int', nullable: true })
  warrantyMonths?: number | null;

  /** Lần nạp bảo hành gần nhất (qua import Excel). */
  @Column({ name: 'warranty_updated_at', type: 'datetime', nullable: true })
  warrantyUpdatedAt?: Date | null;

  @Column({ name: 'stock', type: 'int', nullable: true })
  stock?: number | null;

  @Column({ name: 'is_in_stock', type: 'boolean', nullable: true })
  isInStock?: boolean | null;

  @Column({ name: 'synced_at', type: 'datetime', nullable: true })
  syncedAt?: Date | null;

  @Index('idx_products_active')
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @Column({
    name: 'updated_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;

  @Index('idx_products_category_id')
  @ManyToOne(() => Category, (category: Category) => category.products, {
    nullable: true,
  })
  category?: Category;

  @Index('idx_products_brand_id')
  @ManyToOne(() => Brand, (brand: Brand) => brand.products, { nullable: true })
  brand?: Brand;
}

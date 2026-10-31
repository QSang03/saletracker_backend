import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Product } from './product.entity';

/**
 * Lịch sử biến động giá sản phẩm.
 *
 * Cronjob đồng bộ sản phẩm (product-v2) phát hiện giá đổi A -> B thì ghi một
 * dòng ở đây kèm giá cũ/giá mới để giao diện sale thấy được giá đã biến động.
 * Người dùng sửa giá tay qua PUT /products/:id cũng ghi vào đây (source
 * 'manual') để lịch sử không bị hụt.
 */
@Entity({ name: 'product_price_histories' })
@Index('idx_pph_product_id_changed_at', ['productId', 'changedAt'])
@Index('idx_pph_changed_at', ['changedAt'])
export class ProductPriceHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'product_id', type: 'int' })
  productId: number;

  /** Giữ kèm mã sản phẩm để tra cứu nhanh, không cần join. */
  @Column({ name: 'product_code', type: 'varchar', length: 255 })
  productCode: string;

  /** Giá trước khi đổi — null nếu trước đó sản phẩm chưa có giá. */
  @Column({
    name: 'old_price',
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (value?: number | null) => value ?? null,
      from: (value?: string | number | null) =>
        value === null || value === undefined ? null : Number(value),
    },
  })
  oldPrice?: number | null;

  /** Giá sau khi đổi — null nếu nguồn về null (API trả giá không hợp lệ). */
  @Column({
    name: 'new_price',
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (value?: number | null) => value ?? null,
      from: (value?: string | number | null) =>
        value === null || value === undefined ? null : Number(value),
    },
  })
  newPrice?: number | null;

  /** Thời điểm phát hiện thay đổi (bằng runStartedAt của lần sync). */
  @Column({ name: 'changed_at', type: 'datetime' })
  changedAt: Date;

  /** Nguồn thay đổi: 'sync' (cronjob) hoặc 'manual' (PUT /products/:id). */
  @Column({ type: 'varchar', length: 20, default: 'sync' })
  source: string;

  @Column({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product?: Product;
}

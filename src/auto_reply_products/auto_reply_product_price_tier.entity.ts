import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { AutoReplyProduct } from './auto_reply_product.entity';

@Entity('auto_reply_product_price_tiers')
@Unique('product_quantity_unique', ['productId', 'minQuantity'])
export class AutoReplyProductPriceTier {
  @PrimaryGeneratedColumn({ name: 'price_tier_id' })
  priceTierId: number;

  @Column({ type: 'int', name: 'product_id' })
  productId: number;

  @ManyToOne(() => AutoReplyProduct, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id', referencedColumnName: 'productId' })
  product: AutoReplyProduct;

  @Column({
    type: 'int',
    name: 'min_quantity',
    default: 1,
    comment: 'Số lượng tối thiểu áp dụng cho mức giá này',
  })
  minQuantity: number;

  @Column({
    type: 'decimal',
    name: 'price_per_unit',
    precision: 12,
    scale: 2,
    comment: 'Giá cho mỗi đơn vị sản phẩm ở mức này',
  })
  pricePerUnit: string;

  @CreateDateColumn({
    name: 'created_at',
    comment: 'Thời gian tạo',
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    comment: 'Thời gian cập nhật',
  })
  updatedAt: Date;

  @DeleteDateColumn({
    name: 'deleted_at',
    comment: 'Thời gian xóa',
  })
  deletedAt: Date;
}

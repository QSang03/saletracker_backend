import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Index } from 'typeorm';
import { Category } from '../categories/category.entity';
import { Brand } from '../brands/brand.entity';

@Entity({ name: 'products' })
@Index('idx_products_code', ['productCode'])
@Index('ft_products_name_desc', ['productName', 'description'], { fulltext: true })
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

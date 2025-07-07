import { Entity, PrimaryGeneratedColumn, Column, ManyToMany, JoinTable, ManyToOne } from 'typeorm';
import { Category } from '../categories/category.entity';
import { Brand } from '../brands/brand.entity';

@Entity({ name: 'products' })
export class Product {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'product_name', type: 'varchar', length: 255 })
  productName: string;

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @ManyToMany(() => Category, (category: Category) => category.products, { nullable: true })
  @JoinTable({ name: 'product_categories' })
  categories?: Category[];

  @ManyToOne(() => Brand, (brand: Brand) => brand.products, { nullable: true })
  brand?: Brand;
}

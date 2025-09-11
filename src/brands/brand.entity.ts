import { Entity, PrimaryGeneratedColumn, Column, OneToMany, Index } from 'typeorm';
import { Product } from '../products/product.entity';

@Entity({ name: 'brands' })
export class Brand {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('idx_brands_name')
  @Column({ name: 'name', type: 'varchar', length: 255 })
  name: string;

  @Index('idx_brands_slug')
  @Column({ name: 'slug', type: 'varchar', length: 255, nullable: true })
  slug?: string;

  @Column({ name: 'descriptions', type: 'text', nullable: true })
  descriptions?: string;

  @OneToMany(() => Product, (product) => product.brand)
  products?: Product[];
}

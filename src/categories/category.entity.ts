import { Entity, PrimaryGeneratedColumn, Column, OneToMany, Index } from 'typeorm';
import { Product } from '../products/product.entity';

@Entity({ name: 'categories' })
export class Category {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @Index('idx_categories_cat_name')
  @Column({ name: 'cat_name', type: 'varchar', length: 255 })
  catName: string;

  @Index('idx_categories_slug')
  @Column({ name: 'slug', type: 'varchar', length: 255, nullable: true })
  slug?: string;

  // parent/children relations removed — categories are now flat from the source API

  @OneToMany(() => Product, (product) => product.category)
  products?: Product[];

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

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date;
}

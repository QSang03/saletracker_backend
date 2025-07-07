import { Entity, PrimaryColumn, Column, ManyToOne, OneToMany, ManyToMany } from 'typeorm';
import { Product } from '../products/product.entity';

@Entity({ name: 'categories' })
export class Category {
  @PrimaryColumn({ type: 'int' })
  id: number;

  @Column({ name: 'cat_name', type: 'varchar', length: 255 })
  catName: string;

  @ManyToOne(() => Category, (category) => category.children, { nullable: true })
  parent?: Category;

  @OneToMany(() => Category, (category) => category.parent)
  children?: Category[];

  @ManyToMany(() => Product, (product) => product.categories)
  products?: Product[];

  @Column({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date;
}

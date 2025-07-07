import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { Product } from '../products/product.entity';

@Entity({ name: 'brands' })
export class Brand {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  name: string;

  @Column({ name: 'descriptions', type: 'text', nullable: true })
  descriptions?: string;

  @OneToMany(() => Product, (product) => product.brand)
  products?: Product[];
}

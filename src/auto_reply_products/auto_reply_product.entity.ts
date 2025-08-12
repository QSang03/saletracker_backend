import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AutoReplyProductPriceTier } from './auto_reply_product_price_tier.entity';
import { AutoReplyKeywordRoute } from 'src/auto_reply_keyword_routes/auto_reply_keyword_route.entity';
import { AutoReplyRouteProduct } from './auto_reply_route_product.entity';

@Entity('auto_reply_products')
export class AutoReplyProduct {
  @PrimaryGeneratedColumn({ name: 'product_id' })
  productId: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  code: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  brand: string;

  @Column({ type: 'varchar', length: 255 })
  cate: string;

  @Column({ type: 'json', nullable: true })
  attrs: { title: string; description: string }[];

  @OneToMany(() => AutoReplyProductPriceTier, (priceTier) => priceTier.product)
  priceTiers: AutoReplyProductPriceTier[];

  @OneToMany(() => AutoReplyRouteProduct, (rp) => rp.product)
  routeProducts: AutoReplyRouteProduct[];

  @Column({ type: 'int', default: 0 })
  stock: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date;
}

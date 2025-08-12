import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import { AutoReplyProduct } from "./auto_reply_product.entity";
import { AutoReplyKeywordRoute } from "src/auto_reply_keyword_routes/auto_reply_keyword_route.entity";

@Entity('auto_reply_route_products')
@Unique('uq_route_product', ['routeId', 'productId'])
export class AutoReplyRouteProduct {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'route_id' })
  routeId: number;

  @Column({ name: 'product_id' })
  productId: number;

  @ManyToOne(() => AutoReplyKeywordRoute, (route) => route.routeProducts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'route_id', referencedColumnName: 'routeId' })
  route: AutoReplyKeywordRoute;

  @ManyToOne(() => AutoReplyProduct, (product) => product.routeProducts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id', referencedColumnName: 'productId' })
  product: AutoReplyProduct;

  @Column({ type: 'int', default: 0, comment: 'Thứ tự/độ ưu tiên gợi ý' })
  priority: number;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { bigintTransformer } from '../utils/money.transformer';
import { SaleBuild } from './sale-build.entity';

@Entity('sale_build_items')
@Index('idx_sale_build_items_build', ['buildId'])
@Index('idx_sale_build_items_product_code', ['productCode'])
export class SaleBuildItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'build_id', type: 'int' })
  buildId: number;

  @ManyToOne(() => SaleBuild, (build) => build.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'build_id' })
  build?: SaleBuild;

  @Column({ name: 'product_id', type: 'int', nullable: true })
  productId?: number | null;

  @Column({ name: 'product_code', type: 'varchar', length: 150, nullable: true })
  productCode?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  pn?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  name?: string | null;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  warranty?: string | null;

  @Column({
    name: 'cost_price',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  costPrice?: number | null;

  @Column({
    name: 'sale_price',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  salePrice?: number | null;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({
    name: 'line_total',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  lineTotal?: number | null;

  @Column({ name: 'status_text', type: 'varchar', length: 255, nullable: true })
  statusText?: string | null;

  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_manual', type: 'boolean', default: false })
  isManual: boolean;

  @Column({ name: 'metadata', type: 'json', nullable: true })
  metadata?: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

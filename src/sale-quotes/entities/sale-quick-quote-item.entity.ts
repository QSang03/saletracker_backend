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
import { SaleQuickQuoteCase } from './sale-quick-quote-case.entity';

@Entity('sale_quick_quote_items')
@Index('idx_sale_quick_items_case', ['caseId'])
@Index('idx_sale_quick_items_product_code', ['productCode'])
export class SaleQuickQuoteItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'case_id', type: 'int' })
  caseId: number;

  @ManyToOne(() => SaleQuickQuoteCase, (quickCase) => quickCase.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'case_id' })
  quickCase?: SaleQuickQuoteCase;

  /** Nội dung khách yêu cầu, vd: "i5 13400F" */
  @Column({ name: 'request_text', type: 'text', nullable: true })
  requestText?: string | null;

  /** exact | replacement | equivalent | custom */
  @Column({ name: 'match_type', type: 'varchar', length: 20, default: 'custom' })
  matchType: string;

  @Column({ name: 'product_id', type: 'int', nullable: true })
  productId?: number | null;

  @Column({ name: 'product_code', type: 'varchar', length: 150, nullable: true })
  productCode?: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  pn?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

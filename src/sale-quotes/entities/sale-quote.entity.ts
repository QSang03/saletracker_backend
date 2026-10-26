import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';
import { bigintTransformer } from '../utils/money.transformer';
import { SaleQuoteItem } from './sale-quote-item.entity';

@Entity('sale_quotes')
@Index('idx_sale_quotes_owner_status', ['saleUserId', 'status'])
@Index('idx_sale_quotes_customer_phone', ['customerPhone'])
export class SaleQuote {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('uq_sale_quotes_code', { unique: true })
  @Column({ name: 'quote_code', type: 'varchar', length: 40 })
  quoteCode: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title?: string | null;

  @Column({ name: 'customer_name', type: 'varchar', length: 255, nullable: true })
  customerName?: string | null;

  @Column({ name: 'customer_phone', type: 'varchar', length: 30, nullable: true })
  customerPhone?: string | null;

  @Column({ name: 'customer_address', type: 'varchar', length: 500, nullable: true })
  customerAddress?: string | null;

  @Column({ name: 'sale_user_id', type: 'int' })
  saleUserId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'sale_user_id' })
  saleUser?: User;

  @Index('idx_sale_quotes_status')
  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: string;

  /** standard | build | single | customer */
  @Column({ type: 'varchar', length: 20, default: 'standard' })
  mode: string;

  @Column({ name: 'global_note', type: 'text', nullable: true })
  globalNote?: string | null;

  @Column({ name: 'zalo_suffix', type: 'text', nullable: true })
  zaloSuffix?: string | null;

  @Column({
    name: 'total_amount',
    type: 'bigint',
    default: 0,
    transformer: bigintTransformer,
  })
  totalAmount: number;

  @Column({ name: 'has_unpriced_items', type: 'boolean', default: false })
  hasUnpricedItems: boolean;

  @Column({ name: 'metadata', type: 'json', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt?: Date | null;

  @OneToMany(() => SaleQuoteItem, (item) => item.quote, { cascade: true })
  items: SaleQuoteItem[];

  @Index('idx_sale_quotes_created_at')
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date | null;
}

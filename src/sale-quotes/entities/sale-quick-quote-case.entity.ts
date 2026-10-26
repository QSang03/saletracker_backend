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
import { SaleQuickQuoteItem } from './sale-quick-quote-item.entity';

@Entity('sale_quick_quote_cases')
@Index('idx_sale_quick_cases_owner_status', ['ownerUserId', 'status'])
export class SaleQuickQuoteCase {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'owner_user_id', type: 'int' })
  ownerUserId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id' })
  ownerUser?: User;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title?: string | null;

  @Column({ name: 'customer_name', type: 'varchar', length: 255, nullable: true })
  customerName?: string | null;

  @Column({ name: 'customer_phone', type: 'varchar', length: 30, nullable: true })
  customerPhone?: string | null;

  @Column({ name: 'global_note', type: 'text', nullable: true })
  globalNote?: string | null;

  @Index('idx_sale_quick_cases_status')
  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: string;

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

  @OneToMany(() => SaleQuickQuoteItem, (item) => item.quickCase, {
    cascade: true,
  })
  items: SaleQuickQuoteItem[];

  @Index('idx_sale_quick_cases_created_at')
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date | null;
}

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
import { SaleBuildItem } from './sale-build-item.entity';

@Entity('sale_builds')
@Index('idx_sale_builds_owner_folder', ['ownerUserId', 'folder'])
export class SaleBuild {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'owner_user_id', type: 'int' })
  ownerUserId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id' })
  ownerUser?: User;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Index('idx_sale_builds_folder')
  @Column({ type: 'varchar', length: 100, default: 'Báo Giá Theo Yêu Cầu' })
  folder: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  /**
   * Mảng [{ label: 'CPU', value: 'i5 13400F' }, ...] giống dynamicSpecs
   * trong file HTML.
   */
  @Column({ type: 'json', nullable: true })
  specs?: Array<{ label: string; value: string }> | null;

  @Index('idx_sale_builds_shared')
  @Column({ name: 'is_shared', type: 'boolean', default: false })
  isShared: boolean;

  @Column({ name: 'is_template', type: 'boolean', default: false })
  isTemplate: boolean;

  @Column({
    name: 'total_amount',
    type: 'bigint',
    default: 0,
    transformer: bigintTransformer,
  })
  totalAmount: number;

  @Column({ name: 'has_unpriced_items', type: 'boolean', default: false })
  hasUnpricedItems: boolean;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @OneToMany(() => SaleBuildItem, (item) => item.build, { cascade: true })
  items: SaleBuildItem[];

  @Index('idx_sale_builds_created_at')
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date | null;
}

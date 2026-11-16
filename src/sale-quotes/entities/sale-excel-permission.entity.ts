import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/user.entity';

@Entity('sale_excel_permissions')
export class SaleExcelPermission {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('idx_sep_user', { unique: true })
  @Column({ name: 'user_id', type: 'int', unique: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'can_upload', type: 'boolean', default: false })
  canUpload: boolean;

  @Column({ name: 'can_update', type: 'boolean', default: false })
  canUpdate: boolean;

  @Column({ name: 'can_delete', type: 'boolean', default: false })
  canDelete: boolean;

  @Column({ name: 'assigned_by_user_id', type: 'int', nullable: true })
  assignedByUserId?: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

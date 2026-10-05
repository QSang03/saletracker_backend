import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CustomerImportSession } from './customer-import-session.entity';
import { User } from '../users/user.entity';

/**
 * Snapshot trạng thái trước khi apply, phục vụ hoàn tác (rollback).
 * Sao mẫu debts/debt_import_backups.entity.ts.
 *
 * assignment_id là cột thường KHÔNG FK: nếu dòng phân công bị xoá cứng thì
 * snapshot vẫn còn để khôi phục lại được.
 */
@Entity('customer_import_backups')
@Index('idx_cib_session', ['session'])
export class CustomerImportBackup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  session_id: number;

  @ManyToOne(() => CustomerImportSession, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: CustomerImportSession;

  @Column({ type: 'int' })
  assignment_id: number;

  /** Toàn bộ dữ liệu gốc của dòng phân công + khách hàng trước khi sửa. */
  @Column({ type: 'json' })
  original_data: any;

  /** 'UPDATE' | 'DELETE' | 'CREATE' — khớp với action của change. */
  @Column({ type: 'varchar', length: 50 })
  action_type: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @CreateDateColumn()
  created_at: Date;
}

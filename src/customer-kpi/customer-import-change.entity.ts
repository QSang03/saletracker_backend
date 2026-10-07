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

export enum ImportChangeAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  UNCHANGED = 'unchanged',
}

export enum ImportChangeDecision {
  /** Chưa chọn — mặc định theo đề xuất của hệ thống khi apply. */
  PENDING = 'pending',
  /** Người dùng chọn ghi thay đổi này. */
  APPLY = 'apply',
  /** Người dùng bỏ qua thay đổi này. */
  SKIP = 'skip',
}

/**
 * Một thay đổi đề xuất trong session import — kết quả so khớp file Excel với
 * dữ liệu hiện có. Chỉ là ĐỀ XUẤT: apply mới ghi vào dữ liệu thật.
 */
@Entity('customer_import_changes')
@Index('idx_cic_session', ['session'])
@Index('idx_cic_session_action', ['session', 'action'])
export class CustomerImportChange {
  @PrimaryGeneratedColumn()
  id: number;

  // Cột scalar đi cùng relation bên dưới — em.create({session_id}) không có
  // property này thì TypeORM lặng lẽ bỏ qua khi INSERT
  @Column({ type: 'int' })
  session_id: number;

  @ManyToOne(() => CustomerImportSession, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'session_id' })
  session: CustomerImportSession;

  /** Số dòng trong file Excel — để báo lỗi đúng dòng. */
  @Column({ type: 'int' })
  row_num: number;

  @Column({ type: 'varchar', length: 64 })
  customer_code: string;

  /** Cùng mã khác SAP là khách khác — định danh đầy đủ là cặp (mã, SAP). */
  @Column({ type: 'varchar', length: 32, default: '' })
  sap_code: string;

  @Column({ type: 'varchar', length: 32, nullable: true })
  department_slug: string | null;

  @Column({ type: 'enum', enum: ImportChangeAction })
  action: ImportChangeAction;

  /** Trạng thái dữ liệu TRƯỚC khi đổi (null với create). */
  @Column({ type: 'json', nullable: true })
  old_data: any | null;

  /** Trạng thái dữ liệu SAU khi đổi (đề xuất của hệ thống). */
  @Column({ type: 'json', nullable: true })
  new_data: any | null;

  /** Lỗi dòng dữ liệu bẩn (phân loại sai, trống LOẠI MÃ...) — null nếu ok. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  error: string | null;

  @Column({
    type: 'enum',
    enum: ImportChangeDecision,
    default: ImportChangeDecision.PENDING,
  })
  decision: ImportChangeDecision;

  @Column({ type: 'int', nullable: true })
  decided_by: number | null;

  @Column({ type: 'datetime', nullable: true })
  decided_at: Date | null;

  @CreateDateColumn()
  created_at: Date;
}

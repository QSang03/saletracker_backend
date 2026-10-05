import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApprovalRequest } from './approval-request.entity';
import { CustomerTier } from './customer-assignment.entity';

export enum ApprovalCustomerAction {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
}

/** Một thay đổi danh sách khách hàng trong đề xuất chờ duyệt. */
@Entity('approval_request_customer_items')
@Index('idx_arci_request', ['request'])
export class ApprovalRequestCustomerItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  request_id: number;

  @ManyToOne(() => ApprovalRequest, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request: ApprovalRequest;

  @Column({ type: 'enum', enum: ApprovalCustomerAction })
  action: ApprovalCustomerAction;

  @Column({ type: 'varchar', length: 64 })
  customer_code: string;

  /** Cùng mã khác SAP là khách khác — định danh đầy đủ là cặp (mã, SAP). */
  @Column({ type: 'varchar', length: 32, default: '' })
  sap_code: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  customer_name: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  department_slug: string | null;

  @Column({ type: 'enum', enum: CustomerTier, nullable: true })
  customer_tier: CustomerTier | null;

  /** Trạng thái TRƯỚC khi đổi (null với create). */
  @Column({ type: 'json', nullable: true })
  old_data: any | null;

  /** Trạng thái SAU khi đổi (nội dung đề xuất). */
  @Column({ type: 'json', nullable: true })
  new_data: any | null;

  @CreateDateColumn()
  created_at: Date;
}

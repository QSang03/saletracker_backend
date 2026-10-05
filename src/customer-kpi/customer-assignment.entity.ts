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
import { User } from '../users/user.entity';
import { Customer } from './customer.entity';

/**
 * Key/Non là thuộc tính của CẶP (khách hàng × phòng ban), không phải của khách
 * hàng. Cùng một khách hàng có thể KEY với phòng Laptop nhưng NON với phòng
 * Máy In — xem thiết kế mục 4.1.
 *
 * Vì mỗi phòng ban gán đúng một nhân viên, cặp (khách hàng, phòng ban) xác định
 * duy nhất một quan hệ Sale–khách → ràng buộc UNIQUE 3 cột bên dưới.
 *
 * Mọi bảng con (customer_zalo, customer_activity_daily, customer_response_daily)
 * đều trỏ về bảng này, KHÔNG trỏ thẳng vào customers.
 */
export enum CustomerTier {
  KEY = 'KEY',
  NON = 'NON',
}

@Entity('customer_assignments')
@Index('uq_assignment_customer_sale_dept', ['customer_id', 'sale_id', 'department_slug'], {
  unique: true,
})
@Index('idx_assignment_sale_dept', ['sale_id', 'department_slug'])
@Index('idx_assignment_zalo_account', ['zalo_account_id'])
@Index('idx_assignment_dept_tier', ['department_slug', 'customer_tier'])
export class CustomerAssignment {
  @PrimaryGeneratedColumn()
  id: number;

  // Cột scalar đi cùng relation bên dưới — query theo id không phải join
  @Column({ type: 'int' })
  customer_id: number;

  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ type: 'int' })
  sale_id: number;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'sale_id' })
  sale: User;

  /**
   * Tài khoản Zalo của SALE (mỗi Sale một tài khoản) — zalo_accounts.id ở DB
   * zalo_automation, KHÁC database nên KHÔNG đặt FK được. Bắt buộc có giá trị
   * này trong mọi truy vấn khớp, vì zalo_contact_id chỉ duy nhất trong phạm vi
   * một tài khoản (thiết kế mục 4.2).
   */
  @Column({ type: 'int', nullable: true, comment: 'zalo_accounts.id (DB zalo_automation)' })
  zalo_account_id: number | null;

  @Column({ type: 'varchar', length: 32 })
  department_slug: string;

  @Column({ type: 'enum', enum: CustomerTier })
  customer_tier: CustomerTier;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

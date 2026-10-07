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
import { CustomerAssignment } from './customer-assignment.entity';

/**
 * Vị trí mã khách hàng trong tên Zalo — dùng để thống kê phong cách đặt tên
 * của Sale, từ đó siết thuật toán khớp nếu cần (thiết kế mục 4.3.2 bước 4).
 */
export enum MatchedPosition {
  START = 'start',
  MIDDLE = 'middle',
  END = 'end',
  ONLY = 'only',
}

export enum MatchMethod {
  /** Job tự khớp bằng mã khách hàng trong tên Zalo. */
  AUTO_CODE = 'auto_code',
  /** Người dùng sửa tay — job KHÔNG được ghi đè các dòng này. */
  MANUAL = 'manual',
}

/**
 * Cặp khớp đã vật chất hoá giữa khách hàng và tài khoản Zalo của khách.
 *
 * Quan hệ 1-n: một khách hàng có thể có nhiều người trao đổi Zalo (người mua
 * hàng, kế toán, giám đốc...) — khi tính KPI cộng dồn tất cả. Gắn vào
 * customer_assignments chứ không vào customers: cùng khách hàng nhưng khác
 * Sale là quan hệ khác.
 */
@Entity('customer_zalo')
@Index(
  'uq_customer_zalo_assignment_contact',
  ['assignment_id', 'zalo_contact_id'],
  {
    unique: true,
  },
)
@Index('idx_customer_zalo_contact_active', ['zalo_contact_id', 'is_active'])
export class CustomerZalo {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  assignment_id: number;

  @ManyToOne(() => CustomerAssignment, { nullable: false })
  @JoinColumn({ name: 'assignment_id' })
  assignment: CustomerAssignment;

  /**
   * Bắt buộc kèm mọi truy vấn — zalo_contact_id chỉ duy nhất trong phạm vi một
   * tài khoản Zalo (zalo_accounts.id, DB zalo_automation, không FK được).
   */
  @Column({
    type: 'int',
    nullable: true,
    comment: 'zalo_accounts.id (DB zalo_automation)',
  })
  zalo_account_id: number | null;

  /** ID liên hệ gốc từ Zalo (zalo_contacts.zalo_contact_id). */
  @Column({ type: 'varchar', length: 255 })
  zalo_contact_id: string;

  /** display_name lúc khớp — chỉ để đối chiếu khi người dùng xem lại. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  matched_name: string | null;

  @Column({ type: 'enum', enum: MatchedPosition, nullable: true })
  matched_position: MatchedPosition | null;

  @Column({ type: 'enum', enum: MatchMethod, default: MatchMethod.AUTO_CODE })
  match_method: MatchMethod;

  /** Khớp ≥2 khách hàng trên cùng account → bản ghi trùng đặt false. */
  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'datetime', nullable: true })
  last_verified_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

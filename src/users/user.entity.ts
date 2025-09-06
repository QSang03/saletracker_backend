import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
  DeleteDateColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Role } from '../roles/role.entity';
import { Department } from '../departments/department.entity';
import { UserStatus } from './user-status.enum';
import { Notification } from '../notifications/notification.entity';
import { AutoReplySalesPersona } from 'src/auto_reply_sales_personas/auto_reply_sales_persona.entity';
import { AutoReplyContact } from 'src/auto_reply_contacts/auto_reply_contact.entity';

@Index('idx_users_ar', ['id', 'isAutoReplyEnabled'], { where: '"is_auto_reply_enabled" = true' })
@Entity('users')
export class User {
  toJSON() {
    const { password, ...rest } = this;
    return rest;
  }
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  username: string;

  @Column({ select: false })
  password: string;

  @Column({ nullable: true, name: 'full_name' })
  fullName?: string;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  email?: string | null;

  @Index()
  @Column({ default: false, name: 'is_block' })
  isBlock: boolean;

  @Index()
  @Column({ default: false, name: 'is_auto_reply_enabled' })
  isAutoReplyEnabled: boolean;

  @Index()
  @Column({ type: 'varchar', nullable: true, name: 'employee_code' })
  employeeCode?: string | null;

  @Index()
  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Index()
  @Column({ type: 'datetime', nullable: true })
  lastLogin?: Date | null;

  @Index()
  @Column({ nullable: true, name: 'nick_name' })
  nickName?: string;

  @ManyToMany(() => Role, (role) => role.users, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  @JoinTable({
    name: 'users_roles',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles: Role[];

  @ManyToMany(() => Department, (department) => department.users, {
    nullable: true,
  })
  @JoinTable({
    name: 'users_departments',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'department_id', referencedColumnName: 'id' },
  })
  departments?: Department[];

  @OneToMany(() => AutoReplySalesPersona, (persona) => persona.user)
  salesPersonas: AutoReplySalesPersona[]; // Thuộc tính này sẽ là một mảng các persona

  @OneToMany(() => AutoReplyContact, (contact) => contact.user)
  autoReplyContacts: AutoReplyContact[];

  @Index()
  @Column({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Index()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Index()
  @Column({ type: 'tinyint', default: 0, name: 'zalo_link_status' })
  zaloLinkStatus: number; // 0: chưa liên kết, 1: đã liên kết, 2: lỗi liên kết

  @Index()
  @Column({ nullable: true, name: 'zalo_name' })
  zaloName?: string;

  @Index()
  @Column({ nullable: true, name: 'avatar_zalo' })
  avatarZalo?: string;

  @Index()
  @Column({ nullable: true, name: 'zalo_gender' })
  zaloGender?: string;

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications: Notification[];
  
  @Column({ 
    nullable: true, 
    name: 'refresh_token', 
    select: false,
    type: 'text' // Changed from default varchar to text to handle longer tokens
  })
  refreshToken?: string;

  @Index()
  @Column({ nullable: true, name: 'last_online_at' })
  lastOnlineAt?: Date;
}

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
} from 'typeorm';
import { Role } from '../roles/role.entity';
import { Department } from '../departments/department.entity';
import { UserStatus } from './user-status.enum';
import { Notification } from '../notifications/notification.entity';

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

  @Column({ unique: true, nullable: true })
  email?: string;

  @Column({ default: false, name: 'is_block' })
  isBlock: boolean;

  @Column({ unique: true, nullable: true, name: 'employee_code' })
  employeeCode?: string;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'datetime', nullable: true })
  lastLogin?: Date | null;

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

  @Column({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ type: 'tinyint', default: 0, name: 'zalo_link_status' })
  zaloLinkStatus: number; // 0: chưa liên kết, 1: đã liên kết, 2: lỗi liên kết

  @Column({ nullable: true, name: 'zalo_name' })
  zaloName?: string;

  @Column({ nullable: true, name: 'avatar_zalo' })
  avatarZalo?: string;

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications: Notification[];
}

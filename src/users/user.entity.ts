import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
  ManyToOne,
  DeleteDateColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../roles/role.entity';
import { Department } from '../departments/department.entity';
import { Permission } from '../permissions/permission.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  username: string;

  @Column({ select: false }) // Ẩn password khi query
  password: string;

  @Column({ nullable: true })
  fullName?: string;

  @Column({ unique: true, nullable: true })
  email?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  avatar?: string;

  @Column({ default: 'active' })
  status: 'active' | 'inactive'; // Chỉ định rõ kiểu dữ liệu

  @Column({ type: 'timestamp', nullable: true })
  lastLogin?: Date;

  @ManyToMany(() => Role, (role) => role.users, {
    cascade: true,
    onDelete: 'CASCADE',
  })
  @JoinTable({
    name: 'users_roles',
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'roleId', referencedColumnName: 'id' },
  })
  roles: Role[];

  @ManyToMany(() => Permission, (permission) => permission.users, {
    cascade: true,
  })
  @JoinTable({
    name: 'users_permissions',
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'permissionId', referencedColumnName: 'id' },
  })
  permissions: Permission[]; // Quan hệ trực tiếp với Permission

  @ManyToOne(() => Department, (department) => department.users, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  department?: Department;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deletedAt?: Date;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}

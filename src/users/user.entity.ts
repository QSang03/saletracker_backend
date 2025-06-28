import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
  DeleteDateColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../roles/role.entity';
import { Department } from '../departments/department.entity';
import { UserStatus } from './user-status.enum';

@Entity('users')
export class User {
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

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  avatar?: string;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Column({ type: 'timestamp', nullable: true, name: 'last_login' })
  lastLogin?: Date;

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

  // Many-to-many với Department (optional)
  @ManyToMany(() => Department, (department) => department.users, {
    nullable: true,
  })
  @JoinTable({
    name: 'users_departments',
    joinColumn: { name: 'user_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'department_id', referencedColumnName: 'id' },
  })
  departments?: Department[];

  @DeleteDateColumn({ type: 'timestamp', nullable: true, name: 'deleted_at' })
  deletedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

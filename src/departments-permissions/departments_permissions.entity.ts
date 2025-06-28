import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Department } from '../departments/department.entity';
import { Permission } from '../permissions/permission.entity';

@Entity('departments_permissions')
export class DepartmentPermission {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Department, (department) => department.departmentPermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'department_id' })
  department: Department;

  @ManyToOne(() => Permission, (permission) => permission.departmentPermissions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'permission_id' })
  permission: Permission;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

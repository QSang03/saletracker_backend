import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { RolePermission } from '../roles_permissions/roles_permissions.entity';
import { DepartmentPermission } from '../departments-permissions/departments_permissions.entity';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  action: string;

  @OneToMany(() => RolePermission, (rp) => rp.permission)
  rolePermissions: RolePermission[];

  @OneToMany(() => DepartmentPermission, (dp) => dp.permission)
  departmentPermissions: DepartmentPermission[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}

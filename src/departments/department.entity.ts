import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { DepartmentPermission } from '../departments-permissions/departments_permissions.entity';

@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string;

  @ManyToMany(() => User, (user) => user.departments, {
    nullable: true,
  })
  users?: User[];

  @OneToMany(() => DepartmentPermission, (dp) => dp.department)
  departmentPermissions: DepartmentPermission[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}

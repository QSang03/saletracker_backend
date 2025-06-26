import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  JoinTable,
  ManyToOne,
} from 'typeorm';
import { Role } from '../roles/role.entity';
import { Department } from '../departments/department.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  username: string;

  @Column()
  password: string;

  @ManyToMany(() => Role, (role) => role.users, { cascade: true })
  @JoinTable({ name: 'users_roles' })
  roles: Role[];

  @ManyToOne(() => Department, (department) => department.users, {
    nullable: true,
  })
  department?: Department;
}

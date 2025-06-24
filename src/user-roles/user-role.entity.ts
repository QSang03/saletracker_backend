import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  PrimaryColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { Role } from '../role/role.entity';

@Entity('users_roles')
export class UserRole {

  @PrimaryColumn()
  user_id: string;

  @PrimaryColumn()
  role_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Role)
  @JoinColumn({ name: 'role_id' })
  role: Role;
}
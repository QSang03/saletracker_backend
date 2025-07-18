import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export interface ChangeFullNameLog {
  oldFullName: string;
  newFullName: string;
  timeChange: string;
  changerId: number;
}

@Entity('change_user_logs')
export class ChangeUserLog {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column('json')
  changes: ChangeFullNameLog[];
}
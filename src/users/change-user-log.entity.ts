import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('change_user_logs')
export class ChangeUserLog {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column('simple-array')
  fullNames: string[];

  @Column('simple-array')
  timeChanges: string[];

  @Column('simple-array')
  changerIds: number[];
}
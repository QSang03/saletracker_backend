import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('departments')
export class Department {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  name: string;

  @Index({ unique: true })
  @Column({ unique: true })
  slug: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  server_ip: string;

  @ManyToMany(() => User, (user) => user.departments, {
    nullable: true,
  })
  users?: User[];

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Index()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Index()
  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt?: Date;
}

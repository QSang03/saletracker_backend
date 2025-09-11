import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { CustomerMessageHistory } from 'src/customers/customer_message_history.entity';

@Index('idx_customers_user_zalo', ['userId', 'zaloDisplayName'])
@Index('idx_customers_created_at', ['created_at'])
@Index('idx_customers_deleted_at', ['deleted_at'])
@Entity({ name: 'customers' })
export class Customer {
  // Primary key: BIGINT UNSIGNED AUTO_INCREMENT
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string; // use string in TS for bigint compatibility

  // FK to users.id
  @Index()
  @Column({ name: 'user_id', type: 'int', unsigned: false })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: User;

  @Index()
  @Column({
    name: 'zalo_display_name',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  zaloDisplayName?: string | null;

  @Column({ name: 'salutation', type: 'varchar', length: 50, nullable: true })
  salutation?: string | null;

  @Column({ name: 'greeting_message', type: 'text', nullable: true })
  greetingMessage?: string | null;

  @OneToMany(
    () => CustomerMessageHistory,
    (h: CustomerMessageHistory) => h.customer,
  )
  messageHistories: CustomerMessageHistory[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @DeleteDateColumn()
  deleted_at: Date | null;
}

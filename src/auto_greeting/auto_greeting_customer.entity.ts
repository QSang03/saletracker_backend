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
import { AutoGreetingCustomerMessageHistory } from './auto_greeting_customer_message_history.entity';

@Index('idx_auto_greeting_customers_user_zalo', ['userId', 'zaloDisplayName'])
@Index('idx_auto_greeting_customers_created_at', ['created_at'])
@Index('idx_auto_greeting_customers_deleted_at', ['deleted_at'])
@Entity({ name: 'auto_greeting_customers' })
export class AutoGreetingCustomer {
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
    name: 'zalo_id',
    type: 'varchar',
    length: 100,
    nullable: true,
    unique: true,
  })
  zaloId?: string | null;

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

  @Column({ 
    name: 'conversation_type', 
    type: 'enum',
    enum: ['group', 'private'],
    nullable: true,
    default: 'private'
  })
  conversationType?: 'group' | 'private' | null;

  @Column({ 
    name: 'last_message_date', 
    type: 'datetime', 
    nullable: true 
  })
  lastMessageDate?: Date | null;

  @Column({ 
    name: 'status', 
    type: 'enum',
    enum: ['urgent', 'reminder', 'normal'],
    nullable: true,
    default: 'normal'
  })
  status?: 'urgent' | 'reminder' | 'normal' | null;

  @Column({ 
    name: 'is_active', 
    type: 'tinyint',
    unsigned: true,
    nullable: true,
    comment: '1: active, 0: inactive'
  })
  isActive: number;

  @OneToMany(
    () => AutoGreetingCustomerMessageHistory,
    (h: AutoGreetingCustomerMessageHistory) => h.autoGreetingCustomer,
  )
  messageHistories: AutoGreetingCustomerMessageHistory[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @DeleteDateColumn()
  deleted_at: Date | null;
}

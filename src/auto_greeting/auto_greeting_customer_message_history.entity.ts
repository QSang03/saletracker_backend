import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AutoGreetingCustomer } from './auto_greeting_customer.entity';

@Entity({ name: 'auto_greeting_customer_message_history' })
@Index('idx_agcmh_customer_sent_at', ['customerId', 'sentAt'])
export class AutoGreetingCustomerMessageHistory {
  // BIGINT UNSIGNED AUTO_INCREMENT
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string; // string for bigint

  @Index()
  @Column({ name: 'customer_id', type: 'bigint', unsigned: true })
  customerId: string;

  @ManyToOne(() => AutoGreetingCustomer, (autoGreetingCustomer) => autoGreetingCustomer.messageHistories, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_id', referencedColumnName: 'id' })
  autoGreetingCustomer: AutoGreetingCustomer;

  @Column({ type: 'text' })
  content: string;

  // DATETIME(6) NULL
  @Index()
  @Column({ name: 'sent_at', type: 'datetime', precision: 6, nullable: true })
  sentAt?: Date | null;

  @Index()
  @CreateDateColumn()
  created_at: Date;
}

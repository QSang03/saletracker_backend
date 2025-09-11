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
import { Customer } from './customer.entity';

@Entity({ name: 'customer_message_history' })
@Index('idx_cmh_customer_sent_at', ['customerId', 'sentAt'])
export class CustomerMessageHistory {
  // BIGINT UNSIGNED AUTO_INCREMENT
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string; // string for bigint

  @Index()
  @Column({ name: 'customer_id', type: 'bigint', unsigned: true })
  customerId: string;

  @ManyToOne(() => Customer, (customer) => customer.messageHistories, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_id', referencedColumnName: 'id' })
  customer: Customer;

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

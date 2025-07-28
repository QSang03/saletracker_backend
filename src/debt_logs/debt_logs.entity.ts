import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  Index,
} from 'typeorm';
import { DebtConfig } from '../debt_configs/debt_configs.entity';
import { User } from '../users/user.entity';

export enum ReminderStatus {
  DebtReported = 'Debt Reported',
  FirstReminder = 'First Reminder',
  SecondReminder = 'Second Reminder',
  CustomerResponded = 'Customer Responded',
  NotSent = 'Not Sent',
  ERROR_SEND = 'Error Send',
  SentButNotVerified = 'Sent But Not Verified',
}

@Entity({ name: 'debt_logs' })
@Index('idx_debt_config_id', ['debt_config_id'])
@Index('idx_remind_status', ['remind_status'])
@Index('idx_send_at', ['send_at'])
export class DebtLogs {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  debt_config_id: number;

  @Column({ type: 'longtext', nullable: true })
  error_msg: string;

  @OneToOne(() => DebtConfig, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'debt_config_id' })
  debt_config: DebtConfig;

  @Column({ type: 'longtext', nullable: true })
  debt_msg: string;

  @Column({ type: 'datetime', nullable: true })
  send_at: Date;

  @Column({ type: 'longtext', nullable: true })
  first_remind: string;

  @Column({ type: 'datetime', nullable: true })
  first_remind_at: Date;

  @Column({ type: 'longtext', nullable: true })
  second_remind: string;

  @Column({ type: 'datetime', nullable: true })
  second_remind_at: Date;

  @Column({ type: 'longtext', nullable: true })
  sale_msg: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  conv_id: string;

  @Column({ type: 'longtext', nullable: true })
  debt_img: string;

  @Column({
    type: 'enum',
    enum: ReminderStatus,
    default: ReminderStatus.NotSent,
  })
  remind_status: ReminderStatus;

  @Column({ type: 'text', nullable: true })
  gender: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}

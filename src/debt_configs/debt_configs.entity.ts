import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  ManyToOne,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { Debt } from '../debts/debt.entity';
import { DebtLogs } from '../debt_logs/debt_logs.entity';
import { User } from '../users/user.entity';

export enum CustomerType {
  FIXED = 'fixed',
  NON_FIXED = 'non-fixed',
  CASH = 'cash',
}

@Entity({ name: 'debt_configs' })
export class DebtConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50 })
  customer_code: string;

  @Column({ type: 'varchar', length: 255 })
  customer_name: string;

  @Column({
    type: 'enum',
    enum: CustomerType,
    default: CustomerType.CASH,
  })
  customer_type: CustomerType;

  @Column({ type: 'simple-json', nullable: true })
  day_of_week: number[] | null;

  @Column({ type: 'int', nullable: true })
  gap_day: number | null;

  @Column({ type: 'boolean', default: false })
  is_send: boolean;

  @Column({ type: 'boolean', default: false })
  is_repeat: boolean;

  @Column({ type: 'datetime', nullable: true })
  send_last_at: Date;

  @Column({ type: 'datetime', nullable: true })
  last_update_at: Date;

  @ManyToOne(() => User, { nullable: true })
  actor: User;

  @ManyToOne(() => User, { nullable: true })
  employee?: User;

  @OneToMany(() => Debt, (debt) => debt.debt_config)
  debts: Debt[];

  @OneToOne(() => DebtLogs, (log) => log.debt_config)
  debt_log: DebtLogs;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deleted_at: Date;
}

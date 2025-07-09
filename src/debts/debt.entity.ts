import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, ManyToOne } from 'typeorm';
import { DebtConfig } from '../debt_configs/debt_configs.entity';
import { User } from '../users/user.entity';

@Entity('debts')
export class Debt {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 50 })
  customer_raw_code: string;

  @Column({ length: 50 })
  invoice_code: string;

  @Column({ length: 50 })
  bill_code: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  total_amount: number;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  remaining: number;

  @Column({ type: 'date', nullable: true })
  issue_date: Date;

  @Column({ type: 'date', nullable: true })
  due_date: Date;

  @Column({ default: false })
  pay_later: boolean;

  @Column({ length: 50 })
  status: string;

  @Column({ type: 'int', nullable: true })
  sale_id: number;

  @ManyToOne(() => User, { nullable: true })
  sale: User;

  @Column({ type: 'varchar', length: 255, nullable: true })
  employee_code_raw: string;

  @Column({ type: 'text', nullable: true })
  note: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @DeleteDateColumn()
  deleted_at: Date;

  @Column({ length: 255, nullable: true })
  sale_name_raw: string;

  @Column({ type: 'int', nullable: true })
  debt_config_id: number;

  @ManyToOne(() => DebtConfig, (debtConfig) => debtConfig.debts)
  debt_config: DebtConfig;
}

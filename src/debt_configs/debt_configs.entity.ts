import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, OneToMany, ManyToOne } from 'typeorm';
import { Debt } from '../debts/debt.entity';
import { DebtLogs } from '../debt_logs/debt_logs.entity';
import { User } from '../users/user.entity';

@Entity({ name: 'debt_configs' })
export class DebtConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 50 })
  customer_code: string;

  @Column({ type: 'varchar', length: 255 })
  customer_name: string;

  @Column({ type: 'varchar', length: 50 })
  customer_type: string;

  @Column({ type: 'int', nullable: true })
  day_of_week: number;

  @Column({ type: 'int', nullable: true })
  gap_day: number;

  @Column({ type: 'boolean', default: false })
  is_send: boolean;

  @Column({ type: 'boolean', default: false })
  is_repeat: boolean;

  @Column({ type: 'datetime', nullable: true })
  send_last_at: Date;

  @Column({ type: 'datetime', nullable: true })
  last_update_at: Date;

  @Column({ type: 'int', nullable: true })
  actor_id: number;

  @ManyToOne(() => User, { nullable: true })
  actor: User;

  @Column({ type: 'int', nullable: true })
  employee_id: number;

  @ManyToOne(() => User, { nullable: true })
  employee: User;

  @OneToMany(() => Debt, (debt) => debt.debt_config)
  debts: Debt[];

  @OneToMany(() => DebtLogs, (log) => log.debt_config)
  debt_logs: DebtLogs[];

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deleted_at: Date;
}

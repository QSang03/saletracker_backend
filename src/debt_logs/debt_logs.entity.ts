import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { DebtConfig } from '../debt_configs/debt_configs.entity';
import { User } from '../users/user.entity';

@Entity({ name: 'debt_logs' })
export class DebtLogs {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  debt_config_id: number;

  @ManyToOne(() => DebtConfig, (debtConfig) => debtConfig.debt_logs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'debt_config_id' })
  debt_config: DebtConfig;

  @Column({ type: 'text' })
  debt_msg: string;

  @Column({ type: 'datetime' })
  send_at: Date;

  @Column({ type: 'text', nullable: true })
  first_remind: string;

  @Column({ type: 'datetime', nullable: true })
  first_remind_at: Date;

  @Column({ type: 'text', nullable: true })
  second_remind: string;

  @Column({ type: 'datetime', nullable: true })
  second_remind_at: Date;

  @Column({ type: 'text', nullable: true })
  sale_msg: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  conv_id: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  debt_img: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  remind_status: string;

  @Column({ type: 'text', nullable: true })
  render: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}

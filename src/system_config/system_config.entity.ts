import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Index('idx_system_config_name_status', ['name', 'status'])
@Entity('system_config')
export class SystemConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100, unique: true })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  display_name: string;

  @Column({ type: 'text', nullable: true })
  value: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  type: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  section: string;

  @Column({ type: 'tinyint', default: 1 })
  status: number;

  @CreateDateColumn({ type: 'datetime' })
  created_at: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at: Date;
}

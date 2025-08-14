import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity('langgraph_checkpoints')
@Unique('idx_checkpoint', ['thread_id', 'checkpoint_ns', 'checkpoint_id'])
@Index('idx_thread_id', ['thread_id'])
@Index('idx_type', ['type'])
export class LanggraphCheckpoint {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 100 })
  thread_id: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  checkpoint_ns: string;

  @Column({ type: 'varchar', length: 100 })
  checkpoint_id: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  parent_checkpoint_id?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  type?: string;

  @Column({ type: 'longtext' })
  checkpoint: string;

  @Column({ type: 'text', nullable: true })
  metadata?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

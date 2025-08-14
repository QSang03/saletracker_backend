import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  Unique,
} from 'typeorm';

@Entity('langgraph_writes')
@Unique('idx_write', [
  'thread_id',
  'checkpoint_ns',
  'checkpoint_id',
  'task_id',
  'idx',
])
@Index('idx_checkpoint', ['thread_id', 'checkpoint_ns', 'checkpoint_id'])
export class LanggraphWrites {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @Column({ type: 'varchar', length: 100 })
  thread_id: string;

  @Column({ type: 'varchar', length: 100, default: '' })
  checkpoint_ns: string;

  @Column({ type: 'varchar', length: 100 })
  checkpoint_id: string;

  @Column({ type: 'varchar', length: 100 })
  task_id: string;

  @Column({ type: 'int' })
  idx: number;

  @Column({ type: 'varchar', length: 100 })
  channel: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  type: string | null;

  @Column({ type: 'longtext', nullable: true })
  value: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

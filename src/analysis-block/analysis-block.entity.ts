import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
    ManyToOne,
    JoinColumn,
  } from 'typeorm';
  import { User } from '../users/user.entity';
  
  @Entity('analysis_block')
  @Index(['userId', 'zaloContactId', 'blockType'], { unique: true })
  @Index(['userId'])
  @Index(['zaloContactId'])
  @Index(['blockType'])
  @Index(['created_at'])
  @Index(['userId', 'created_at'])
  export class AnalysisBlock {
    @PrimaryGeneratedColumn('increment', { type: 'bigint' })
    id: number;
  
    @Column({
      name: 'user_id',
      type: 'bigint',
      comment: 'ID của user bị chặn phân tích',
    })
    userId: number;
  
    @ManyToOne(() => User, {
      eager: false,
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    })
    @JoinColumn({ name: 'user_id' })
    user: User;
  
    @Column({
      name: 'zalo_contact_id',
      type: 'varchar',
      length: 255,
      comment: 'Zalo contact ID từ order_details.metadata.customer_id',
    })
    zaloContactId: string;
  
    @Column({
      type: 'longtext',
      nullable: true,
      comment: 'Lý do chặn phân tích',
    })
    reason?: string;
  
    @Column({
      name: 'block_type',
      type: 'enum',
      enum: ['analysis', 'reporting', 'stats'],
      default: 'analysis',
      comment: 'Loại chặn: analysis, reporting, stats',
    })
    blockType: 'analysis' | 'reporting' | 'stats';
  
    @CreateDateColumn({ type: 'timestamp' })
    created_at: Date;
  
    @UpdateDateColumn({ type: 'timestamp', nullable: true })
    updated_at: Date;
  }
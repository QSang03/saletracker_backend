import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum ChangeAction {
    INSERT = 'INSERT',
    UPDATE = 'UPDATE',
    DELETE = 'DELETE'
}

@Index('idx_table_record', ['table_name', 'record_id'])
@Index('idx_processed', ['processed'])
@Index('idx_triggered_at', ['triggered_at'])
@Entity('database_change_log')
export class DatabaseChangeLog {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 50 })
    table_name: string;

    @Column()
    record_id: number;

    @Column({ 
        type: 'enum',
        enum: ChangeAction 
    })
    action: ChangeAction;

    @Column({ 
        type: 'json',
        nullable: true 
    })
    old_values: any;

    @Column({ 
        type: 'json',
        nullable: true 
    })
    new_values: any;

    @Column({ 
        type: 'json',
        nullable: true 
    })
    changed_fields: string[];

    @CreateDateColumn()
    triggered_at: Date;

    @Column({ 
        type: 'boolean',
        default: false 
    })
    processed: boolean;

    @UpdateDateColumn({ nullable: true })
    processed_at: Date;
}
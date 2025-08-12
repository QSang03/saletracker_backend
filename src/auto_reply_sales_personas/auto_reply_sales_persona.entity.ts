import { User } from 'src/users/user.entity';
import { Column, Entity, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, ManyToOne, JoinColumn } from 'typeorm';

@Entity('auto_reply_sales_personas')
export class AutoReplySalesPersona {
    @PrimaryGeneratedColumn({ name: 'persona_id' })
    personaId: number;

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ type: 'text', name: 'persona_prompt', comment: 'Lưu system prompt cho tính cách sale' })
    personaPrompt: string;

    @ManyToOne(() => User, (user) => user.salesPersonas)
    @JoinColumn({ name: 'user_id' }) // Liên kết với cột khóa ngoại ở trên
    user: User;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @DeleteDateColumn({ name: 'deleted_at', nullable: true })
    deletedAt: Date | null;
}

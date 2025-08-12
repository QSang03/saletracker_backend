import { Column, Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { AutoReplyContact } from '../auto_reply_contacts/auto_reply_contact.entity';

export enum ConversationState {
    SLEEP = 'SLEEP',
    IDLE = 'IDLE',
    PROCESSING = 'PROCESSING',
    ESCALATED = 'ESCALATED',
    COMPLETED = 'COMPLETED',
}

@Entity('auto_reply_conversations')
export class AutoReplyConversation {
    @PrimaryGeneratedColumn({ name: 'conv_id' })
    convId: number;

    @Column({ type: 'int', name: 'contact_id' })
    contactId: number;

    @ManyToOne(() => AutoReplyContact, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'contact_id', referencedColumnName: 'contactId' })
    contact: AutoReplyContact;

    @Column({ type: 'enum', enum: ConversationState, default: ConversationState.IDLE })
    state: ConversationState;

    @Column({ type: 'tinyint', name: 'followup_stage', default: 0, comment: '0: chưa nhắc, 1: đã nhắc lần 1, 2: đã nhắc lần 2' })
    followupStage: number;

    @Column({ type: 'timestamp', name: 'last_user_msg_at', nullable: true })
    lastUserMsgAt: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
    updatedAt: Date;
}

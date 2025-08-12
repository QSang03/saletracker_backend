import { Column, Entity, PrimaryGeneratedColumn, OneToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from 'typeorm';
import { AutoReplyContact } from '../auto_reply_contacts/auto_reply_contact.entity';

@Entity('auto_reply_customer_profiles')
export class AutoReplyCustomerProfile {
    @PrimaryGeneratedColumn({ name: 'profile_id' })
    profileId: number;

    @Column({ type: 'int', name: 'contact_id', unique: true })
    contactId: number;

    @OneToOne(() => AutoReplyContact)
    @JoinColumn({ name: 'contact_id', referencedColumnName: 'contactId' })
    contact: AutoReplyContact;

    @Column({ type: 'text', comment: 'Lưu ghi chú và thông tin tùy chỉnh' })
    notes: string;

    @Column({ type: 'text', comment: 'Lưu gợi ý về giọng điệu' })
    toneHints: string;

    @Column({ type: 'decimal', name: 'aov_threshold', precision: 12, scale: 2, nullable: true })
    aovThreshold: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;

    @DeleteDateColumn({ name: 'deleted_at' })
    deletedAt: Date | null;
}

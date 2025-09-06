import { AutoReplySalesPersona } from 'src/auto_reply_sales_personas/auto_reply_sales_persona.entity';
import { User } from 'src/users/user.entity';
import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ContactRole {
  SUPPLIER = 'supplier',
  CUSTOMER = 'customer',
  INTERNAL = 'internal',
}

@Entity('auto_reply_contacts')
@Index('idx_arc_contact', ['contactId'], { where: '"auto_reply_on" = true' })
@Index('uq_user_zalo_contact', ['user', 'zaloContactId'], { unique: true })
export class AutoReplyContact {
  @PrimaryGeneratedColumn({ name: 'contact_id' })
  contactId: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'zalo_contact_id',
    nullable: false,
  })
  zaloContactId: string;

  @Column({ type: 'text', name: 'last_message', nullable: true })
  lastMessage: string | null;

  @Column({ type: 'enum', enum: ContactRole, default: ContactRole.CUSTOMER })
  role: ContactRole;

  @Column({ type: 'boolean', name: 'auto_reply_on', default: false })
  autoReplyOn: boolean;

  @ManyToOne(() => User, (user) => user.autoReplyContacts, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: User;

  @ManyToOne(() => AutoReplySalesPersona, { nullable: true })
  @JoinColumn({
    name: 'assigned_persona_id',
    referencedColumnName: 'personaId',
  })
  assignedPersona: AutoReplySalesPersona | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}

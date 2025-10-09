import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AutoReplyConversation } from '../auto_reply_conversations/auto_reply_conversation.entity';

export enum AutoReplyMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
  HUMAN = 'human',
  SYSTEM = 'system',
  TOOL = 'tool',
}

@Index('idx_fingerprint', ['convId', 'messageFingerprint'])
@Entity('auto_reply_messages')

export class AutoReplyMessage {
  @PrimaryGeneratedColumn({ name: 'msg_id', type: 'int' })
  msgId: number;

  @Column({ type: 'int', name: 'conv_id' })
  convId: number;

  @ManyToOne(() => AutoReplyConversation)
  @JoinColumn({ name: 'conv_id', referencedColumnName: 'convId' })
  conversation: AutoReplyConversation;

  @Column({
    type: 'enum',
    enum: AutoReplyMessageRole,
    nullable: false,
    comment: 'Vai trò trong hội thoại OpenAI',
  })
  role: AutoReplyMessageRole;

  @Column({ type: 'text', name: 'text_content' })
  textContent: string;

  // Hash of normalized message content for takeover detection
  @Column({
    type: 'bigint',
    name: 'message_fingerprint',
    nullable: true,
    comment: 'Hash of normalized message content for takeover detection',
  })
  messageFingerprint: string | null;

  @Column({ type: 'boolean', name: 'by_bot', default: false })
  byBot: boolean;

  @Column({
    type: 'timestamp',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;
}

import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Mốc tương tác mới nhất của một assignment — Python ghi sau mỗi lượt quét SLA.
 *
 * `customer_activity_daily` chỉ có grain NGÀY nên `by-sale` không biết giờ gửi
 * tin cuối; bảng này lưu timestamp gốc từ `zalo_messages` để trả
 * `lastMessageAt` chính xác. Không có dòng nghĩa là chưa từng quét thấy tin.
 */
@Entity('customer_interaction_summary')
export class CustomerInteractionSummary {
  @PrimaryColumn({ type: 'int' })
  assignment_id: number;

  @Column({ type: 'datetime', nullable: true })
  last_inbound_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  last_outbound_at: Date | null;

  @Column({ type: 'datetime', nullable: true })
  last_message_at: Date | null;

  @UpdateDateColumn()
  updated_at: Date;
}

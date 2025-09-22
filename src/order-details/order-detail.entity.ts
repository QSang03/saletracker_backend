import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from 'typeorm';
import { Product } from '../products/product.entity';
import { Order } from '../orders/order.entity';
export enum OrderDetailStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  DEMAND = 'demand',
  QUOTED = 'quoted',
  CONFIRMED = 'confirmed',
}
export enum ExtendReason {
  SYSTEM_SUNDAY_AUTO = 'hệ thống tự gia hạn vào chủ nhật hoặc nghỉ lễ',
  USER_MANUAL = 'chính chủ gia hạn',
  SYSTEM_RESTORE = 'hệ thống gia hạn khi khôi phục đơn',
}
@Index('idx_order_details_order_status', ['order_id', 'status'])
@Index('idx_order_details_product_status', ['product_id', 'status'])
@Index('idx_order_details_customer_name', ['customer_name'])
@Index('idx_order_details_created_at', ['created_at'])
@Index('idx_order_details_deleted_at', ['deleted_at'])
@Index('idx_order_details_customer_created', ['customer_name', 'created_at'])
@Index('idx_order_details_customer_created_deleted', ['customer_name', 'created_at', 'deleted_at'])
// Phase 2.1: Tối ưu hóa index cho order_details table
@Index('idx_order_details_created_status', ['created_at', 'status', 'deleted_at'])
@Index('idx_order_details_order_created', ['order_id', 'created_at'])
@Index('idx_order_details_sale_status', ['order_id', 'status'])
// Phase 2.6: Index cho hidden orders
@Index('idx_order_details_hidden_at', ['hidden_at'], { where: 'hidden_at IS NOT NULL' })
@Index('idx_order_details_hidden_status', ['hidden_at', 'status', 'deleted_at'])
@Index('idx_order_details_hidden_employee', ['hidden_at', 'order_id'])
@Index('idx_order_details_hidden_pagination', ['hidden_at', 'id'], { where: 'hidden_at IS NOT NULL' })
// Generated columns for JSON extractions and calculations
@Index('idx_order_details_meta_customer_id', ['meta_customer_id'])
@Index('idx_order_details_meta_is_group', ['meta_is_group'])
@Index('idx_order_details_expiry_days', ['expiry_days', 'created_at', 'id'])
// Optimized index for expiry-based filtering with status
@Index('idx_expiry_days_status', ['expiry_days', 'status', 'id'])
// Index for raw_item prefix to optimize product code comparison
@Index('idx_order_details_raw_item_prefix', ['raw_item_prefix'])
// Composite index for optimizing product code comparison with generated column
@Index('idx_order_details_product_raw_prefix', ['product_id', 'raw_item_prefix'])
// Indexes for conversation timestamps
@Index('idx_conversation_start', ['conversation_start'])
@Index('idx_conversation_end', ['conversation_end'])
@Index('idx_conversation_duration', ['conversation_start', 'conversation_end'])
// Fulltext index for raw_item search optimization
@Index('ft_order_details_raw_item', ['raw_item'], { fulltext: true })
@Entity('order_details')
export class OrderDetail {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: number;

  @ManyToOne(() => Order, (order) => order.details, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Index()
  @Column('bigint', { nullable: false })
  order_id: number;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Index()
  @Column({
    type: 'enum',
    enum: OrderDetailStatus,
    default: OrderDetailStatus.PENDING,
  })
  status: OrderDetailStatus;

  @Index()
  @Column('bigint', { nullable: true })
  product_id: number;

  @Column('int', { default: 1 })
  quantity: number;

  @Column('int', { default: 4 })
  extended: number;

  @Index()
  @Column('timestamp', { nullable: true, default: null })
  last_extended_at: Date;

  @Column({
    type: 'enum',
    enum: ExtendReason,
    nullable: true,
    default: null,
  })
  extend_reason: ExtendReason;

  @Column('bigint', { unsigned: true, default: 0 })
  unit_price: number;

  @Column({ type: 'longtext', nullable: true })
  customer_request_summary: string;

  @Column('text', { nullable: true })
  raw_item: string;

  @Column('longtext', { nullable: true })
  notes: string;

  @Column('json', { nullable: true })
  notes_history: { user_id: number | null; content: string; changed_at: string }[];

  @Column('longtext', { nullable: true })
  reason: string;

  @Column('varchar', { nullable: true })
  customer_name: string;

  @Column('varchar', {
    name: 'zalo_message_id',
    length: 255,
    nullable: true,
    unique: true,
  })
  zaloMessageId: string;

  @Column('json', { nullable: true })
  metadata: Record<string, any>;

  @Index()
  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @Index()
  @UpdateDateColumn({ type: 'timestamp', nullable: true })
  updated_at: Date;

  @DeleteDateColumn({ type: 'timestamp', nullable: true })
  deleted_at: Date;

  @Index()
  @Column('timestamp', { nullable: true })
  hidden_at: Date | null;

  // Generated columns for optimized querying
  @Column({
    type: 'varchar',
    length: 50,
    nullable: true,
    asExpression: "CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.customer_id')) = 'null' OR JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.customer_id')) IS NULL THEN NULL ELSE JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.customer_id')) END",
    generatedType: 'STORED',
  })
  meta_customer_id: string | null;

  @Column({
    type: 'tinyint',
    nullable: true,
    asExpression: "CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.conversation_info.is_group')) IN ('null', 'false', '') OR JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.conversation_info.is_group')) IS NULL THEN 0 WHEN JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.conversation_info.is_group')) = 'true' THEN 1 ELSE CAST(JSON_UNQUOTE(JSON_EXTRACT(`metadata`, '$.conversation_info.is_group')) AS UNSIGNED) END",
    generatedType: 'STORED',
  })
  meta_is_group: number | null;

  @Column({
    type: 'int',
    nullable: true,
    asExpression: "(TO_DAYS(DATE(`created_at`)) + COALESCE(`extended`, 0))",
    generatedType: 'STORED',
  })
  expiry_days: number | null;

  // Generated column for raw_item prefix to optimize product code comparison
  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    asExpression: "LEFT(TRIM(`raw_item`), 255)",
    generatedType: 'STORED',
  })
  raw_item_prefix: string | null;

  // Generated columns for conversation timestamps
  // conversation_start: phần tử đầu
  @Column({
    type: 'datetime',
    nullable: true,
    asExpression: `
      CASE
        WHEN JSON_TYPE(JSON_EXTRACT(metadata, '$.messages')) = 'ARRAY'
             AND JSON_LENGTH(JSON_EXTRACT(metadata, '$.messages')) > 0
        THEN STR_TO_DATE(
               LEFT(
                 JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.messages[0].timestamp')),
                 19
               ),
               '%Y-%m-%dT%H:%i:%s'
             )
        ELSE NULL
      END
    `,
    generatedType: 'STORED',
  })
  conversation_start: Date | null;

  // conversation_end: phần tử cuối
  @Column({
    type: 'datetime',
    nullable: true,
    asExpression: `
      CASE
        WHEN JSON_TYPE(JSON_EXTRACT(metadata, '$.messages')) = 'ARRAY'
             AND JSON_LENGTH(JSON_EXTRACT(metadata, '$.messages')) > 0
        THEN STR_TO_DATE(
               LEFT(
                 JSON_UNQUOTE(
                   JSON_EXTRACT(
                     metadata,
                     CONCAT('$.messages[',
                            JSON_LENGTH(JSON_EXTRACT(metadata, '$.messages')) - 1,
                            '].timestamp')
                   )
                 ),
                 19
               ),
               '%Y-%m-%dT%H:%i:%s'
             )
        ELSE NULL
      END
    `,
    generatedType: 'STORED',
  })
  conversation_end: Date | null;
}

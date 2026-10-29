import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

export interface OrderStatusContext {
  actorId?: number | null;
  actorName?: string | null;
  source:
    | 'manual'
    | 'bulk_update'
    | 'care'
    | 'system'
    | 'create'
    | 'migration';
  note?: string | null;
  careBatchId?: number | null;
}

/**
 * Set session variables để trigger `order_details_after_update` ghi
 * `order_status_histories` kèm actor/source. Trigger chỉ dùng context nếu
 * `@order_status_context_at` còn mới (<= 60s) để tránh leak qua connection pool.
 */
@Injectable()
export class OrderStatusContextService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async runWithContext<T>(
    context: OrderStatusContext,
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SET @order_status_actor_id = ?,
             @order_status_actor_name = ?,
             @order_status_source = ?,
             @order_status_note = ?,
             @order_status_care_batch_id = ?,
             @order_status_context_at = UNIX_TIMESTAMP()`,
        [
          context.actorId ?? null,
          context.actorName ?? null,
          context.source,
          context.note ?? null,
          context.careBatchId ?? null,
        ],
      );

      try {
        return await fn(manager);
      } finally {
        try {
          await manager.query(
            `SET @order_status_actor_id = NULL,
                 @order_status_actor_name = NULL,
                 @order_status_source = NULL,
                 @order_status_note = NULL,
                 @order_status_care_batch_id = NULL,
                 @order_status_context_at = NULL`,
          );
        } catch {
          // Transaction đã rollback: bỏ qua, trigger có freshness 60s để tránh leak.
        }
      }
    });
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Trigger ghi lịch sử trạng thái cho order_details.
 *
 * - AFTER INSERT: ghi trạng thái khởi tạo.
 * - AFTER UPDATE: chỉ ghi khi status thay đổi.
 * - Actor/source lấy từ session variables do OrderStatusContextService set.
 *   Context chỉ được dùng nếu còn mới (<= 60s) để tránh leak qua pool.
 */
@Injectable()
export class SeedOrderStatusTriggerService {
  private readonly logger = new Logger(SeedOrderStatusTriggerService.name);

  private static readonly TRIGGER_NAMES = [
    'order_details_after_insert',
    'order_details_after_update',
  ];

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async seedTriggers(): Promise<void> {
    try {
      const hasTable = await this.dataSource.query(
        `SELECT 1 FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'order_status_histories'
         LIMIT 1`,
      );
      if (!hasTable.length) {
        this.logger.warn(
          '⏳ order_status_histories chưa tồn tại — bỏ qua tạo trigger lịch sử trạng thái',
        );
        return;
      }

      for (const name of SeedOrderStatusTriggerService.TRIGGER_NAMES) {
        await this.dataSource.query(`DROP TRIGGER IF EXISTS \`${name}\``);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));

      await this.dataSource.query(this.insertTrigger());
      await this.dataSource.query(this.updateTrigger());

      this.logger.log(
        '✅ [SeedOrderStatusTrigger] 2 trigger lịch sử trạng thái order_details đã sẵn sàng',
      );
    } catch (error: any) {
      // Không làm sập boot: lịch sử là cơ chế quan sát, không chặn nghiệp vụ.
      this.logger.error(
        `❌ [SeedOrderStatusTrigger] Không tạo được trigger: ${error?.message}`,
      );
    }
  }

  private insertTrigger(): string {
    return `
      CREATE TRIGGER \`order_details_after_insert\`
      AFTER INSERT ON \`order_details\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`order_status_histories\` (
          \`order_detail_id\`, \`order_id\`, \`from_status\`, \`to_status\`,
          \`changed_by\`, \`changed_by_name\`, \`source\`, \`note\`,
          \`care_batch_id\`, \`changed_at\`
        ) VALUES (
          NEW.id, NEW.order_id, NULL, NEW.status,
          NULL, NULL, 'create', NULL, NULL, NOW(3)
        );
      END
    `;
  }

  private updateTrigger(): string {
    return `
      CREATE TRIGGER \`order_details_after_update\`
      AFTER UPDATE ON \`order_details\`
      FOR EACH ROW
      BEGIN
        IF NOT (OLD.status <=> NEW.status) THEN
          INSERT INTO \`order_status_histories\` (
            \`order_detail_id\`, \`order_id\`, \`from_status\`, \`to_status\`,
            \`changed_by\`, \`changed_by_name\`, \`source\`, \`note\`,
            \`care_batch_id\`, \`changed_at\`
          ) VALUES (
            NEW.id,
            NEW.order_id,
            OLD.status,
            NEW.status,
            IF(@order_status_context_at IS NOT NULL
               AND @order_status_context_at >= UNIX_TIMESTAMP() - 60,
               @order_status_actor_id, NULL),
            IF(@order_status_context_at IS NOT NULL
               AND @order_status_context_at >= UNIX_TIMESTAMP() - 60,
               @order_status_actor_name, NULL),
            IF(@order_status_context_at IS NOT NULL
               AND @order_status_context_at >= UNIX_TIMESTAMP() - 60,
               COALESCE(@order_status_source, 'manual'), 'system'),
            IF(@order_status_context_at IS NOT NULL
               AND @order_status_context_at >= UNIX_TIMESTAMP() - 60,
               @order_status_note, NULL),
            IF(@order_status_context_at IS NOT NULL
               AND @order_status_context_at >= UNIX_TIMESTAMP() - 60,
               @order_status_care_batch_id, NULL),
            NOW(3)
          );
        END IF;
      END
    `;
  }
}

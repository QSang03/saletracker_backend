import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SeedUserTriggerService {
  private readonly logger = new Logger(SeedUserTriggerService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private readonly UPDATE_TRIGGER_NAME = 'users_after_update_zalo_link_status';

  async seedTriggers() {
    try {
      const existing = await this.checkExistingTrigger();
      if (existing) {
        return;
      }
      await this.createTrigger();
    } catch (err) {
      this.logger.error('Failed to seed user trigger', err.stack);
    }
  }

  private async checkExistingTrigger(): Promise<boolean> {
    const sql = `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?`;
    const result = await this.dataSource.query(sql, [this.UPDATE_TRIGGER_NAME]);
    return result.length > 0;
  }

  private async createTrigger() {
    const sql = `
      CREATE TRIGGER \`${this.UPDATE_TRIGGER_NAME}\`
      AFTER UPDATE ON \`users\`
      FOR EACH ROW
      BEGIN
        IF (OLD.zalo_link_status IS NULL AND NEW.zalo_link_status IS NOT NULL)
           OR (OLD.zalo_link_status IS NOT NULL AND NEW.zalo_link_status IS NULL)
           OR (OLD.zalo_link_status <> NEW.zalo_link_status) THEN
          INSERT INTO \`database_change_log\`(
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'users', NEW.id, 'UPDATE',
            JSON_OBJECT('zalo_link_status', OLD.zalo_link_status),
            JSON_OBJECT('zalo_link_status', NEW.zalo_link_status),
            JSON_ARRAY('zalo_link_status'),
            NOW()
          );
        END IF;
      END
    `;
    await this.dataSource.query(`DROP TRIGGER IF EXISTS \`${this.UPDATE_TRIGGER_NAME}\``);
    await this.dataSource.query(sql);
  }
}

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
        this.logger.log('User trigger already exists, recreating to ensure latest version...');
      }
      await this.createTrigger();
      this.logger.log('User trigger created/updated successfully');
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
        -- Chỉ trigger khi zalo_link_status thực sự thay đổi
        IF OLD.zalo_link_status IS DISTINCT FROM NEW.zalo_link_status THEN
          
          -- Kiểm tra xem đã có log gần đây chưa (trong vòng 5 giây) để tránh duplicate
          -- Sử dụng logic kiểm tra chặt chẽ hơn
          IF NOT EXISTS (
            SELECT 1 FROM \`database_change_log\` 
            WHERE \`table_name\` = 'users' 
              AND \`record_id\` = NEW.id 
              AND \`action\` = 'UPDATE'
              AND \`triggered_at\` > DATE_SUB(NOW(), INTERVAL 5 SECOND)
              AND JSON_EXTRACT(\`changed_fields\`, '$[0]') = 'zalo_link_status'
              AND JSON_EXTRACT(\`old_values\`, '$.zalo_link_status') = OLD.zalo_link_status
              AND JSON_EXTRACT(\`new_values\`, '$.zalo_link_status') = NEW.zalo_link_status
          ) THEN
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
        END IF;
      END
    `;
    await this.dataSource.query(`DROP TRIGGER IF EXISTS \`${this.UPDATE_TRIGGER_NAME}\``);
    await this.dataSource.query(sql);
  }
}

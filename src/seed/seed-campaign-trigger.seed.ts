import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SeedCampaignTriggerService {
  private readonly logger = new Logger(SeedCampaignTriggerService.name);
  
  constructor(private readonly dataSource: DataSource) {}

  async seed(force: boolean = false): Promise<void> {
    try {
      // Kiểm tra xem trigger đã được tạo chưa (trừ khi force = true)
      if (!force && await this.isTriggersExist()) {
        this.logger.log('Campaign audit triggers already exist, skipping seed... (use force=true to recreate)');
        return;
      }

      if (force) {
        this.logger.log('Force recreating campaign triggers...');
        await this.dropExistingTriggers();
      }

      await this.createAuditTable();
      await this.createAuditFunction();
      await this.createTriggersForTables();
      
      // Đánh dấu trigger đã được seed
      await this.markTriggersAsSeeded();
      
      this.logger.log('Campaign triggers seeded successfully');
    } catch (error) {
      this.logger.error('Error seeding campaign triggers:', error);
      throw error;
    }
  }

  async forceReseed(): Promise<void> {
    return this.seed(true);
  }

  private async dropExistingTriggers(): Promise<void> {
    try {
      const tablesToAudit = [
        'users',
        'campaigns'
      ];

      for (const tableName of tablesToAudit) {
        await this.dataSource.query(`DROP TRIGGER IF EXISTS ${tableName}_audit_insert`);
        await this.dataSource.query(`DROP TRIGGER IF EXISTS ${tableName}_audit_update`);
        await this.dataSource.query(`DROP TRIGGER IF EXISTS ${tableName}_audit_delete`);
      }
      
      this.logger.log('Existing triggers dropped successfully');
    } catch (error) {
      this.logger.error('Error dropping existing triggers:', error);
      throw error;
    }
  }

  private async isTriggersExist(): Promise<boolean> {
    try {
      // Chỉ cần kiểm tra trigger có tồn tại trong database hay không
      const triggerCheck = await this.dataSource.query(`
        SELECT COUNT(*) as count 
        FROM information_schema.triggers 
        WHERE trigger_schema = DATABASE() 
        AND trigger_name LIKE '%_audit_%'
      `);
      
      return triggerCheck[0].count > 0;
    } catch (error) {
      this.logger.error('Error checking triggers existence:', error);
      return false;
    }
  }

  private async markTriggersAsSeeded(): Promise<void> {
    // Không cần tạo bảng tracking nữa, vì đã check trigger trực tiếp
    this.logger.log('Triggers marked as seeded (by existence check)');
  }

  private async createAuditTable(): Promise<void> {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS campaign_audit_history (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        table_name VARCHAR(255) NOT NULL,
        row_identifier JSON NULL,
        old_data JSON NULL,
        new_data JSON NULL,
        operation_type VARCHAR(20) NOT NULL,
        changed_by_user_id BIGINT NULL,
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_table_name (table_name),
        INDEX idx_operation_type (operation_type),
        INDEX idx_changed_at (changed_at),
        INDEX idx_changed_by_user_id (changed_by_user_id)
      )
    `;
    
    await this.dataSource.query(createTableQuery);
    this.logger.log('Audit table created successfully');
  }

  private async createAuditFunction(): Promise<void> {
    // MySQL không cần function riêng, logic sẽ được viết trực tiếp trong trigger
    this.logger.log('Audit logic will be embedded directly in triggers (MySQL approach)');
  }

  private async createTriggersForTables(): Promise<void> {
    // Chỉ audit cho users và campaigns
    const tablesToAudit = [
      'users',
      'campaigns'
    ];

    for (const tableName of tablesToAudit) {
      await this.createTriggersForTable(tableName);
    }
  }

  private async createTriggersForTable(tableName: string): Promise<void> {
    // Check if table exists
    const tableExists = await this.dataSource.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = ?
    `, [tableName]);

    if (tableExists[0].count === 0) {
      this.logger.warn(`Table ${tableName} does not exist, skipping trigger creation`);
      return;
    }

    // Drop existing triggers
    await this.dataSource.query(`DROP TRIGGER IF EXISTS ${tableName}_audit_insert`);
    await this.dataSource.query(`DROP TRIGGER IF EXISTS ${tableName}_audit_update`);
    await this.dataSource.query(`DROP TRIGGER IF EXISTS ${tableName}_audit_delete`);

    // Create INSERT trigger với logic embedded
    const insertTrigger = `
      CREATE TRIGGER ${tableName}_audit_insert
      AFTER INSERT ON ${tableName}
      FOR EACH ROW
      BEGIN
        DECLARE current_user_id BIGINT DEFAULT NULL;
        SET current_user_id = @current_user_id;
        
        INSERT INTO campaign_audit_history(
          table_name, 
          row_identifier, 
          new_data, 
          operation_type, 
          changed_by_user_id
        ) VALUES (
          '${tableName}',
          JSON_OBJECT('id', NEW.id),
          CAST(CONCAT('{', 
            CASE WHEN NEW.id IS NOT NULL THEN CONCAT('"id":', NEW.id, ',') ELSE '' END,
            CASE WHEN NEW.created_at IS NOT NULL THEN CONCAT('"created_at":"', NEW.created_at, '",') ELSE '' END,
            CASE WHEN NEW.updated_at IS NOT NULL THEN CONCAT('"updated_at":"', NEW.updated_at, '",') ELSE '' END,
            '"table":"', '${tableName}', '"',
            '}') AS JSON),
          'INSERT',
          current_user_id
        );
      END
    `;

    // Create UPDATE trigger với logic embedded
    const updateTrigger = `
      CREATE TRIGGER ${tableName}_audit_update
      AFTER UPDATE ON ${tableName}
      FOR EACH ROW
      BEGIN
        DECLARE current_user_id BIGINT DEFAULT NULL;
        SET current_user_id = @current_user_id;
        
        INSERT INTO campaign_audit_history(
          table_name,
          row_identifier,
          old_data,
          new_data,
          operation_type,
          changed_by_user_id
        ) VALUES (
          '${tableName}',
          JSON_OBJECT('id', COALESCE(NEW.id, OLD.id)),
          CAST(CONCAT('{', 
            CASE WHEN OLD.id IS NOT NULL THEN CONCAT('"id":', OLD.id, ',') ELSE '' END,
            CASE WHEN OLD.created_at IS NOT NULL THEN CONCAT('"created_at":"', OLD.created_at, '",') ELSE '' END,
            CASE WHEN OLD.updated_at IS NOT NULL THEN CONCAT('"updated_at":"', OLD.updated_at, '",') ELSE '' END,
            '"table":"', '${tableName}', '"',
            '}') AS JSON),
          CAST(CONCAT('{', 
            CASE WHEN NEW.id IS NOT NULL THEN CONCAT('"id":', NEW.id, ',') ELSE '' END,
            CASE WHEN NEW.created_at IS NOT NULL THEN CONCAT('"created_at":"', NEW.created_at, '",') ELSE '' END,
            CASE WHEN NEW.updated_at IS NOT NULL THEN CONCAT('"updated_at":"', NEW.updated_at, '",') ELSE '' END,
            '"table":"', '${tableName}', '"',
            '}') AS JSON),
          'UPDATE',
          current_user_id
        );
      END
    `;

    // Create DELETE trigger với logic embedded
    const deleteTrigger = `
      CREATE TRIGGER ${tableName}_audit_delete
      AFTER DELETE ON ${tableName}
      FOR EACH ROW
      BEGIN
        DECLARE current_user_id BIGINT DEFAULT NULL;
        SET current_user_id = @current_user_id;
        
        INSERT INTO campaign_audit_history(
          table_name,
          row_identifier,
          old_data,
          operation_type,
          changed_by_user_id
        ) VALUES (
          '${tableName}',
          JSON_OBJECT('id', OLD.id),
          CAST(CONCAT('{', 
            CASE WHEN OLD.id IS NOT NULL THEN CONCAT('"id":', OLD.id, ',') ELSE '' END,
            CASE WHEN OLD.created_at IS NOT NULL THEN CONCAT('"created_at":"', OLD.created_at, '",') ELSE '' END,
            CASE WHEN OLD.updated_at IS NOT NULL THEN CONCAT('"updated_at":"', OLD.updated_at, '",') ELSE '' END,
            '"table":"', '${tableName}', '"',
            '}') AS JSON),
          'DELETE',
          current_user_id
        );
      END
    `;

    try {
      await this.dataSource.query(insertTrigger);
      await this.dataSource.query(updateTrigger);
      await this.dataSource.query(deleteTrigger);
      
      this.logger.log(`Triggers created for table: ${tableName}`);
    } catch (error) {
      this.logger.error(`Error creating triggers for table ${tableName}:`, error);
      throw error;
    }
  }
}
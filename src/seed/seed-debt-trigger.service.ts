import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SeedDebtTriggerService implements OnModuleInit {
  /**
   * Remove all *_after_insert triggers if they exist in the database
   */
  public async removeInsertTriggers() {
    const insertTriggers = [
      'debt_logs_after_insert',
      'debt_configs_after_insert',
      'debts_after_insert',
    ];
    // Query for existing insert triggers
    const query = `
      SELECT TRIGGER_NAME 
      FROM information_schema.TRIGGERS 
      WHERE TRIGGER_SCHEMA = DATABASE()
        AND TRIGGER_NAME IN (${insertTriggers.map(t => `'${t}'`).join(',')})
    `;
    const result = await this.dataSource.query(query);
    const existingInsertTriggers = result.map(row => row.TRIGGER_NAME);
    for (const triggerName of existingInsertTriggers) {
      try {
        await this.dataSource.query(`DROP TRIGGER \`${triggerName}\``);
        this.logger.log(`🗑️ [SeedDebtTriggerService] Dropped insert trigger: ${triggerName}`);
      } catch (error) {
        if (!error.message.includes("doesn't exist")) {
          this.logger.warn(`⚠️ [SeedDebtTriggerService] Warning dropping insert trigger ${triggerName}: ${error.message}`);
        }
      }
      await new Promise(res => setTimeout(res, 100));
    }
    if (existingInsertTriggers.length === 0) {
      this.logger.log('✅ [SeedDebtTriggerService] No insert triggers found to remove.');
    }
  }
  private readonly logger = new Logger(SeedDebtTriggerService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.removeInsertTriggers();
  }

  public async seedTriggers() {
    try {
      this.logger.log('🔧 [SeedDebtTriggerService] Checking and creating database triggers...');

      // Always recreate triggers to ensure they are up to date
      this.logger.log('🔄 [SeedDebtTriggerService] Recreating all triggers to ensure latest version...');
      
      // Drop all existing triggers first
      const existingTriggers = await this.checkExistingTriggers();
      if (existingTriggers.triggers.length > 0) {
        await this.dropExistingTriggers(existingTriggers.triggers);
        // Add delay after dropping all triggers
        await new Promise(res => setTimeout(res, 500));
      }

      // Create new triggers
      await this.createTriggers();

      this.logger.log('✅ [SeedDebtTriggerService] Database triggers created successfully!');
    } catch (error) {
      this.logger.error(`❌ [SeedDebtTriggerService] Failed to seed triggers: ${error.message}`);
      throw error;
    }
  }

  private async checkExistingTriggers(): Promise<{ hasAll: boolean; triggers: string[] }> {
    const query = `
      SELECT TRIGGER_NAME 
      FROM information_schema.TRIGGERS 
      WHERE TRIGGER_SCHEMA = DATABASE()
        AND TRIGGER_NAME IN (
          'debt_logs_after_update', 
          'debt_configs_after_update',
          'debts_after_update'
        )
    `;

    const result = await this.dataSource.query(query);
    const existingTriggers = result.map(row => row.TRIGGER_NAME);
    
    const expectedTriggers = [
      'debt_logs_after_update', 
      'debt_configs_after_update',
      'debts_after_update'
    ];

    const hasAll = expectedTriggers.every(trigger => existingTriggers.includes(trigger));

    this.logger.log(`📋 [SeedDebtTriggerService] Found existing triggers: ${existingTriggers.join(', ') || 'none'}`);

    return {
      hasAll,
      triggers: existingTriggers
    };
  }

  private async dropExistingTriggers(existingTriggers: string[]) {
    // Get all possible trigger names to ensure we drop everything
    const allPossibleTriggers = [
      'debt_logs_after_update', 
      'debt_configs_after_update',
      'debts_after_update'
    ];

    for (const triggerName of allPossibleTriggers) {
      try {
        // Use direct DROP without IF EXISTS
        await this.dataSource.query(`DROP TRIGGER \`${triggerName}\``);
        this.logger.log(`🗑️ [SeedDebtTriggerService] Dropped trigger: ${triggerName}`);
      } catch (error) {
        // Ignore error if trigger doesn't exist
        if (!error.message.includes("doesn't exist")) {
          this.logger.warn(`⚠️ [SeedDebtTriggerService] Warning dropping trigger ${triggerName}: ${error.message}`);
        }
      }
      // Small delay between each drop
      await new Promise(res => setTimeout(res, 100));
    }
  }

  private async createTriggers(existingTriggers: string[] = []) {
    const triggers = [
      {
        name: 'debt_logs_after_update', 
        sql: this.getDebtLogsUpdateTrigger()
      },
      {
        name: 'debt_configs_after_update',
        sql: this.getDebtConfigsUpdateTrigger()
      },
      {
        name: 'debts_after_update',
        sql: this.getDebtsUpdateTrigger()
      }
    ];

    for (const trigger of triggers) {
      try {
        // Simply create trigger (triggers should be dropped already in seedTriggers)
        await this.dataSource.query(trigger.sql);
        this.logger.log(`✅ [SeedDebtTriggerService] Created trigger: ${trigger.name}`);
      } catch (error) {
        this.logger.error(`❌ [SeedDebtTriggerService] Failed to create trigger ${trigger.name}: ${error.message}`);
        throw error;
      }
    }
  }

  private getDebtLogsInsertTrigger(): string {
    return `
      CREATE TRIGGER \`debt_logs_after_insert\` 
      AFTER INSERT ON \`debt_logs\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'debt_logs', NEW.id, 'INSERT', 
          JSON_OBJECT(
            'id', NEW.id,
            'debt_config_id', NEW.debt_config_id,
            'remind_status', NEW.remind_status,
            'send_at', NEW.send_at,
            'first_remind_at', NEW.first_remind_at,
            'second_remind_at', NEW.second_remind_at,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          ),
          NOW()
        );
      END
    `;
  }

  private getDebtLogsUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`debt_logs_after_update\` 
      AFTER UPDATE ON \`debt_logs\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();
        
        -- Check each field for changes
        IF OLD.remind_status != NEW.remind_status THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'remind_status');
        END IF;
        
        IF OLD.send_at != NEW.send_at OR (OLD.send_at IS NULL AND NEW.send_at IS NOT NULL) OR (OLD.send_at IS NOT NULL AND NEW.send_at IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'send_at');
        END IF;
        
        IF OLD.first_remind_at != NEW.first_remind_at OR (OLD.first_remind_at IS NULL AND NEW.first_remind_at IS NOT NULL) OR (OLD.first_remind_at IS NOT NULL AND NEW.first_remind_at IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'first_remind_at');
        END IF;
        
        IF OLD.second_remind_at != NEW.second_remind_at OR (OLD.second_remind_at IS NULL AND NEW.second_remind_at IS NOT NULL) OR (OLD.second_remind_at IS NOT NULL AND NEW.second_remind_at IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'second_remind_at');
        END IF;
        
        -- Only log if there are actual changes
        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'debt_logs', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'debt_config_id', OLD.debt_config_id,
              'remind_status', OLD.remind_status,
              'send_at', OLD.send_at,
              'first_remind_at', OLD.first_remind_at,
              'second_remind_at', OLD.second_remind_at,
              'updated_at', OLD.updated_at
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'debt_config_id', NEW.debt_config_id,
              'remind_status', NEW.remind_status,
              'send_at', NEW.send_at,
              'first_remind_at', NEW.first_remind_at,
              'second_remind_at', NEW.second_remind_at,
              'updated_at', NEW.updated_at
            ),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }

  private getDebtConfigsInsertTrigger(): string {
    return `
      CREATE TRIGGER \`debt_configs_after_insert\` 
      AFTER INSERT ON \`debt_configs\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'debt_configs', NEW.id, 'INSERT',
          JSON_OBJECT(
            'id', NEW.id,
            'customer_code', NEW.customer_code,
            'is_send', NEW.is_send,
            'gap_day', NEW.gap_day,
            'day_of_week', NEW.day_of_week,
            'send_last_at', NEW.send_last_at,
            'last_update_at', NEW.last_update_at
          ),
          NOW()
        );
      END
    `;
  }

  private getDebtConfigsUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`debt_configs_after_update\` 
      AFTER UPDATE ON \`debt_configs\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();
        
        -- Check for changes in important fields
        IF OLD.is_send != NEW.is_send THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'is_send');
        END IF;
        
        IF OLD.gap_day != NEW.gap_day THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'gap_day');
        END IF;
        
        IF OLD.day_of_week != NEW.day_of_week THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'day_of_week');
        END IF;
        
        IF OLD.send_last_at != NEW.send_last_at OR (OLD.send_last_at IS NULL AND NEW.send_last_at IS NOT NULL) OR (OLD.send_last_at IS NOT NULL AND NEW.send_last_at IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'send_last_at');
        END IF;
        
        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'debt_configs', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'customer_code', OLD.customer_code,
              'is_send', OLD.is_send,
              'gap_day', OLD.gap_day,
              'day_of_week', OLD.day_of_week,
              'send_last_at', OLD.send_last_at,
              'last_update_at', OLD.last_update_at
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'customer_code', NEW.customer_code,
              'is_send', NEW.is_send,
              'gap_day', NEW.gap_day,
              'day_of_week', NEW.day_of_week,
              'send_last_at', NEW.send_last_at,
              'last_update_at', NEW.last_update_at
            ),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }

  // NEW: Debts table triggers
  private getDebtsInsertTrigger(): string {
    return `
      CREATE TRIGGER \`debts_after_insert\` 
      AFTER INSERT ON \`debts\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'debts', NEW.id, 'INSERT',
          JSON_OBJECT(
            'id', NEW.id,
            'customer_raw_code', NEW.customer_raw_code,
            'invoice_code', NEW.invoice_code,
            'bill_code', NEW.bill_code,
            'total_amount', NEW.total_amount,
            'remaining', NEW.remaining,
            'status', NEW.status,
            'pay_later', NEW.pay_later,
            'issue_date', NEW.issue_date,
            'due_date', NEW.due_date,
            'debt_config_id', NEW.debt_config_id,
            'note', NEW.note,
            'is_notified', NEW.is_notified,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          ),
          NOW()
        );
      END
    `;
  }

  private getDebtsUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`debts_after_update\` 
      AFTER UPDATE ON \`debts\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();
        
        -- Check for changes in critical debt fields
        IF OLD.status != NEW.status THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'status');
        END IF;
        
        IF OLD.total_amount != NEW.total_amount THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'total_amount');
        END IF;
        
        IF OLD.remaining != NEW.remaining THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'remaining');
        END IF;
        
        IF OLD.pay_later != NEW.pay_later OR (OLD.pay_later IS NULL AND NEW.pay_later IS NOT NULL) OR (OLD.pay_later IS NOT NULL AND NEW.pay_later IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'pay_later');
        END IF;
        
        IF OLD.issue_date != NEW.issue_date OR (OLD.issue_date IS NULL AND NEW.issue_date IS NOT NULL) OR (OLD.issue_date IS NOT NULL AND NEW.issue_date IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'issue_date');
        END IF;
        
        IF OLD.due_date != NEW.due_date OR (OLD.due_date IS NULL AND NEW.due_date IS NOT NULL) OR (OLD.due_date IS NOT NULL AND NEW.due_date IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'due_date');
        END IF;
        
        IF OLD.note != NEW.note OR (OLD.note IS NULL AND NEW.note IS NOT NULL) OR (OLD.note IS NOT NULL AND NEW.note IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'note');
        END IF;
        
        IF OLD.is_notified != NEW.is_notified THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'is_notified');
        END IF;
        
        IF OLD.debt_config_id != NEW.debt_config_id OR (OLD.debt_config_id IS NULL AND NEW.debt_config_id IS NOT NULL) OR (OLD.debt_config_id IS NOT NULL AND NEW.debt_config_id IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'debt_config_id');
        END IF;
        
        -- Only log if there are actual changes
        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'debts', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'customer_raw_code', OLD.customer_raw_code,
              'invoice_code', OLD.invoice_code,
              'bill_code', OLD.bill_code,
              'total_amount', OLD.total_amount,
              'remaining', OLD.remaining,
              'status', OLD.status,
              'pay_later', OLD.pay_later,
              'issue_date', OLD.issue_date,
              'due_date', OLD.due_date,
              'debt_config_id', OLD.debt_config_id,
              'note', OLD.note,
              'is_notified', OLD.is_notified,
              'updated_at', OLD.updated_at
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'customer_raw_code', NEW.customer_raw_code,
              'invoice_code', NEW.invoice_code,
              'bill_code', NEW.bill_code,
              'total_amount', NEW.total_amount,
              'remaining', NEW.remaining,
              'status', NEW.status,
              'pay_later', NEW.pay_later,
              'issue_date', NEW.issue_date,
              'due_date', NEW.due_date,
              'debt_config_id', NEW.debt_config_id,
              'note', NEW.note,
              'is_notified', NEW.is_notified,
              'updated_at', NEW.updated_at
            ),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }

  // Public methods for manual trigger management
  async recreateTriggers() {
    this.logger.log('🔄 [SeedDebtTriggerService] Manually recreating all triggers...');
    // Drop all triggers
    const existingTriggersResult = await this.checkExistingTriggers();
    await this.dropExistingTriggers(existingTriggersResult.triggers);
    // Sau khi drop, không trigger nào còn tồn tại
    await this.createTriggers([]);
    this.logger.log('✅ [SeedDebtTriggerService] All triggers recreated successfully!');
  }

  async dropAllTriggers() {
    this.logger.log('🗑️ [SeedDebtTriggerService] Dropping all triggers...');
    
    const existingTriggers = await this.checkExistingTriggers();
    await this.dropExistingTriggers(existingTriggers.triggers);
    
    this.logger.log('✅ [SeedDebtTriggerService] All triggers dropped successfully!');
  }

  async getTriggersStatus() {
    const existingTriggers = await this.checkExistingTriggers();
    
    return {
      hasAllTriggers: existingTriggers.hasAll,
      existingTriggers: existingTriggers.triggers,
      expectedTriggers: [
        'debt_logs_after_update', 
        'debt_configs_after_update',
        'debts_after_update'
      ]
    };
  }
}
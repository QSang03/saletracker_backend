import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SeedDebtTriggerService implements OnModuleInit {
  
  private readonly logger = new Logger(SeedDebtTriggerService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // Configuration for allowed fields to track in triggers
  private readonly ALLOWED_TRACKING_FIELDS = {
    debt_logs: [
      'remind_status',    // Critical business status
      'send_at',        // Reminder timing
    ],
    debt_configs: [
      'is_send',        // Enable/disable flag
      'gap_day',        // Reminder frequency
      'day_of_week',    // Reminder scheduling
      'send_last_at'    // Last reminder timestamp
    ],
    debts: [
      'status',         // Debt lifecycle status
      'total_amount',   // Financial amount
      'remaining',      // Outstanding balance
      'pay_later',      // Payment deferral
      'due_date',       // Payment deadline
      'is_notified',    // Notification status
      'debt_config_id'  // Configuration reference
    ]
  };

  /**
   * Get allowed tracking fields for a specific table
   */
  public getAllowedTrackingFields(tableName: keyof typeof this.ALLOWED_TRACKING_FIELDS): string[] {
    return this.ALLOWED_TRACKING_FIELDS[tableName] || [];
  }

  /**
   * Generate dynamic update trigger SQL based on allowed tracking fields
   */
  private generateUpdateTriggerSQL(tableName: string, allowedFields: string[], allFields: Record<string, string>): string {
    const fieldChecks = allowedFields.map(field => {
      const fieldType = allFields[field];
      if (fieldType === 'datetime' || fieldType === 'timestamp') {
        // Handle nullable datetime fields
        return `
        -- ${field}: ${this.getFieldDescription(tableName, field)}
        IF OLD.${field} != NEW.${field} OR (OLD.${field} IS NULL AND NEW.${field} IS NOT NULL) OR (OLD.${field} IS NOT NULL AND NEW.${field} IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', '${field}');
        END IF;`;
      } else {
        // Handle non-nullable fields
        return `
        -- ${field}: ${this.getFieldDescription(tableName, field)}
        IF OLD.${field} != NEW.${field} THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', '${field}');
        END IF;`;
      }
    }).join('');

    return `
      CREATE TRIGGER \`${tableName}_after_update\` 
      AFTER UPDATE ON \`${tableName}\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();
        ${fieldChecks}
        
        -- Only log if there are actual changes to tracked fields
        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            '${tableName}', NEW.id, 'UPDATE',
            JSON_OBJECT(${this.generateJsonObjectFields(allFields, 'OLD')}),
            JSON_OBJECT(${this.generateJsonObjectFields(allFields, 'NEW')}),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }

  /**
   * Get field description for documentation
   */
  private getFieldDescription(tableName: string, fieldName: string): string {
    const descriptions: Record<string, Record<string, string>> = {
      debt_logs: {
        remind_status: 'Critical business status',
        send_at: 'Reminder timing',
        first_remind_at: 'First reminder timing',
        second_remind_at: 'Second reminder timing'
      },
      debt_configs: {
        is_send: 'Enable/disable flag',
        gap_day: 'Reminder frequency',
        day_of_week: 'Reminder scheduling',
        send_last_at: 'Last reminder timestamp'
      },
      debts: {
        status: 'Debt lifecycle status',
        total_amount: 'Financial amount',
        remaining: 'Outstanding balance',
        pay_later: 'Payment deferral',
        due_date: 'Payment deadline',
        is_notified: 'Notification status',
        debt_config_id: 'Configuration reference'
      }
    };
    
    return descriptions[tableName]?.[fieldName] || 'Field tracking enabled';
  }

  /**
   * Generate JSON_OBJECT fields for trigger
   */
  private generateJsonObjectFields(allFields: Record<string, string>, prefix: 'OLD' | 'NEW'): string {
    return Object.keys(allFields).map(field => `'${field}', ${prefix}.${field}`).join(', ');
  }

  async onModuleInit() {
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
    const allTriggers = [
      'debt_logs_after_insert', 'debt_logs_after_update',
      'debt_configs_after_insert', 'debt_configs_after_update',
      'debts_after_insert', 'debts_after_update'
    ];
    const query = `
      SELECT TRIGGER_NAME 
      FROM information_schema.TRIGGERS 
      WHERE TRIGGER_SCHEMA = DATABASE()
        AND TRIGGER_NAME IN (${allTriggers.map(t => `'${t}'`).join(',')})
    `;
    const result = await this.dataSource.query(query);
    const existingTriggers = result.map(row => row.TRIGGER_NAME);
    const hasAll = allTriggers.every(trigger => existingTriggers.includes(trigger));
    this.logger.log(`📋 [SeedDebtTriggerService] Found existing triggers: ${existingTriggers.join(', ') || 'none'}`);
    return {
      hasAll,
      triggers: existingTriggers
    };
  }

  private async dropExistingTriggers(existingTriggers: string[]) {
    // Drop all 6 triggers if they exist
    const allPossibleTriggers = [
      'debt_logs_after_insert', 'debt_logs_after_update',
      'debt_configs_after_insert', 'debt_configs_after_update',
      'debts_after_insert', 'debts_after_update'
    ];
    for (const triggerName of allPossibleTriggers) {
      try {
        await this.dataSource.query(`DROP TRIGGER \`${triggerName}\``);
        this.logger.log(`🗑️ [SeedDebtTriggerService] Dropped trigger: ${triggerName}`);
      } catch (error) {
        if (!error.message.includes("doesn't exist")) {
          this.logger.warn(`⚠️ [SeedDebtTriggerService] Warning dropping trigger ${triggerName}: ${error.message}`);
        }
      }
      await new Promise(res => setTimeout(res, 100));
    }
  }

  private async createTriggers(existingTriggers: string[] = []) {
    const triggers = [
      { name: 'debt_logs_after_insert', sql: this.getDebtLogsInsertTrigger() },
      { name: 'debt_logs_after_update', sql: this.getDebtLogsUpdateTrigger() },
      { name: 'debt_configs_after_insert', sql: this.getDebtConfigsInsertTrigger() },
      { name: 'debt_configs_after_update', sql: this.getDebtConfigsUpdateTrigger() },
      { name: 'debts_after_insert', sql: this.getDebtsInsertTrigger() },
      { name: 'debts_after_update', sql: this.getDebtsUpdateTrigger() }
    ];
    for (const trigger of triggers) {
      try {
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
        
        -- Only track specific allowed fields for debt_logs
        -- remind_status: Critical business status
        IF OLD.remind_status != NEW.remind_status THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'remind_status');
        END IF;
        
        -- send_at: Important for tracking when reminders are sent
        IF OLD.send_at != NEW.send_at OR (OLD.send_at IS NULL AND NEW.send_at IS NOT NULL) OR (OLD.send_at IS NOT NULL AND NEW.send_at IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'send_at');
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
        
        -- Only track business-critical configuration changes
        -- is_send: Critical flag for enabling/disabling debt reminders
        IF OLD.is_send != NEW.is_send THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'is_send');
        END IF;
        
        -- gap_day: Important for reminder frequency configuration
        IF OLD.gap_day != NEW.gap_day THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'gap_day');
        END IF;
        
        -- day_of_week: Important for reminder scheduling
        IF OLD.day_of_week != NEW.day_of_week THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'day_of_week');
        END IF;
        
        -- send_last_at: Track when last reminder was sent
        IF OLD.send_last_at != NEW.send_last_at OR (OLD.send_last_at IS NULL AND NEW.send_last_at IS NOT NULL) OR (OLD.send_last_at IS NOT NULL AND NEW.send_last_at IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'send_last_at');
        END IF;
        
        -- NOTE: customer_code, last_update_at are NOT tracked
        -- customer_code: Should not change after creation
        -- last_update_at: Automatic timestamp, not business critical
        
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
        
        -- Only track critical business fields for debt records
        -- status: Critical for debt lifecycle (paid, pending, overdue, etc.)
        IF OLD.status != NEW.status THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'status');
        END IF;

        -- pay_later: Important for payment deferral tracking
        IF OLD.pay_later != NEW.pay_later OR (OLD.pay_later IS NULL AND NEW.pay_later IS NOT NULL) OR (OLD.pay_later IS NOT NULL AND NEW.pay_later IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'pay_later');
        END IF;
        
        -- debt_config_id: Important when debt configuration changes
        IF OLD.debt_config_id != NEW.debt_config_id OR (OLD.debt_config_id IS NULL AND NEW.debt_config_id IS NOT NULL) OR (OLD.debt_config_id IS NOT NULL AND NEW.debt_config_id IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'debt_config_id');
        END IF;
        
        -- NOTE: Fields NOT tracked to reduce noise:
        -- customer_raw_code: Should not change after creation
        -- invoice_code, bill_code: Should not change after creation  
        -- issue_date: Should not change after creation
        -- note: Non-critical metadata
        -- created_at, updated_at: Automatic timestamps
        
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
        'debt_logs_after_insert', 'debt_logs_after_update',
        'debt_configs_after_insert', 'debt_configs_after_update',
        'debts_after_insert', 'debts_after_update'
      ],
      allowedTrackingFields: this.ALLOWED_TRACKING_FIELDS
    };
  }

  /**
   * Create triggers with strict field whitelisting
   * Only specified fields will be tracked for changes
   */
  async createSelectiveTriggers(tableFieldConfig?: {
    debt_logs?: string[];
    debt_configs?: string[];
    debts?: string[];
  }) {
    this.logger.log('🎯 [SeedDebtTriggerService] Creating selective triggers (insert & update) with field whitelisting...');
    const config = tableFieldConfig || this.ALLOWED_TRACKING_FIELDS;
    const existingTriggers = await this.checkExistingTriggers();
    if (existingTriggers.triggers.length > 0) {
      await this.dropExistingTriggers(existingTriggers.triggers);
      await new Promise(res => setTimeout(res, 300));
    }
    const tables = ['debt_logs', 'debt_configs', 'debts'] as const;
    for (const tableName of tables) {
      const allowedFields = config[tableName] || [];
      if (allowedFields.length === 0) {
        this.logger.warn(`⚠️ [SeedDebtTriggerService] No allowed fields specified for ${tableName}, skipping trigger creation`);
        continue;
      }
      this.logger.log(`📋 [SeedDebtTriggerService] Creating triggers for ${tableName} (insert & update) with fields: ${allowedFields.join(', ')}`);
      // Insert trigger
      let insertTriggerSQL: string;
      let updateTriggerSQL: string;
      switch (tableName) {
        case 'debt_logs':
          insertTriggerSQL = this.getDebtLogsInsertTrigger();
          updateTriggerSQL = this.getDebtLogsUpdateTrigger();
          break;
        case 'debt_configs':
          insertTriggerSQL = this.getDebtConfigsInsertTrigger();
          updateTriggerSQL = this.getDebtConfigsUpdateTrigger();
          break;
        case 'debts':
          insertTriggerSQL = this.getDebtsInsertTrigger();
          updateTriggerSQL = this.getDebtsUpdateTrigger();
          break;
        default:
          continue;
      }
      try {
        await this.dataSource.query(insertTriggerSQL);
        this.logger.log(`✅ [SeedDebtTriggerService] Created selective trigger: ${tableName}_after_insert`);
        await this.dataSource.query(updateTriggerSQL);
        this.logger.log(`✅ [SeedDebtTriggerService] Created selective trigger: ${tableName}_after_update`);
      } catch (error) {
        this.logger.error(`❌ [SeedDebtTriggerService] Failed to create selective triggers for ${tableName}: ${error.message}`);
        throw error;
      }
    }
    this.logger.log('🎯 [SeedDebtTriggerService] Selective triggers (insert & update) created successfully!');
  }

  /**
   * Validate if a field is allowed to be tracked
   */
  public isFieldAllowedForTracking(tableName: keyof typeof this.ALLOWED_TRACKING_FIELDS, fieldName: string): boolean {
    return this.ALLOWED_TRACKING_FIELDS[tableName]?.includes(fieldName) || false;
  }
}
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class SeedCampaignTriggerService implements OnModuleInit {
  
  private readonly logger = new Logger(SeedCampaignTriggerService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // Configuration for allowed fields to track in triggers
  private readonly ALLOWED_TRACKING_FIELDS = {
    campaigns: [
      'status',         // Campaign status changes (draft, active, paused, completed, cancelled)
    ],
    campaign_interaction_logs: [
      'message_content_sent',     // Message content that was sent
      'attachment_sent',          // Attachments sent to customer
      'status',                   // Log status (pending, sent, delivered, failed, etc.)
      'sent_at',                  // When message was sent
      'customer_replied_at',      // When customer replied
      'customer_reply_content',   // Customer's reply content
      'staff_handled_at',         // When staff handled the interaction
      'staff_reply_content',      // Staff's reply content
      'conversation_metadata'     // Conversation metadata
    ],
    campaign_schedules: [
      'start_date',     // Campaign start date
      'end_date'        // Campaign end date
    ]
  };

  /**
   * Get allowed tracking fields for a specific table
   */
  public getAllowedTrackingFields(tableName: keyof typeof this.ALLOWED_TRACKING_FIELDS): string[] {
    return this.ALLOWED_TRACKING_FIELDS[tableName] || [];
  }

  /**
   * Get field description for documentation
   */
  private getFieldDescription(tableName: string, fieldName: string): string {
    const descriptions: Record<string, Record<string, string>> = {
      campaigns: {
        status: 'Campaign lifecycle status (draft, active, paused, completed, cancelled)'
      },
      campaign_interaction_logs: {
        message_content_sent: 'Message content sent to customer',
        attachment_sent: 'Attachments sent to customer',
        status: 'Interaction log status',
        sent_at: 'Message sent timestamp',
        customer_replied_at: 'Customer reply timestamp',
        customer_reply_content: 'Customer reply message content',
        staff_handled_at: 'Staff handling timestamp',
        staff_reply_content: 'Staff reply message content',
        conversation_metadata: 'Conversation metadata and context'
      },
      campaign_schedules: {
        start_date: 'Campaign start date',
        end_date: 'Campaign end date'
      }
    };
    
    return descriptions[tableName]?.[fieldName] || 'Field tracking enabled';
  }

  async onModuleInit() {
  }

  public async seedTriggers() {
    try {
      this.logger.log('🔧 [SeedCampaignTriggerService] Checking and creating campaign database triggers...');

      // Always recreate triggers to ensure they are up to date
      this.logger.log('🔄 [SeedCampaignTriggerService] Recreating all triggers to ensure latest version...');
      
      // Drop all existing triggers first
      const existingTriggers = await this.checkExistingTriggers();
      if (existingTriggers.triggers.length > 0) {
        await this.dropExistingTriggers(existingTriggers.triggers);
        // Add delay after dropping all triggers
        await new Promise(res => setTimeout(res, 500));
      }

      // Create new triggers
      await this.createTriggers();

      this.logger.log('✅ [SeedCampaignTriggerService] Campaign database triggers created successfully!');
    } catch (error) {
      this.logger.error(`❌ [SeedCampaignTriggerService] Failed to seed triggers: ${error.message}`);
      throw error;
    }
  }

  private async checkExistingTriggers(): Promise<{ hasAll: boolean; triggers: string[] }> {
    const allTriggers = [
      'campaigns_after_insert', 'campaigns_after_update',
      'campaign_interaction_logs_after_insert', 'campaign_interaction_logs_after_update',
      'campaign_schedules_after_insert', 'campaign_schedules_after_update'
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
    this.logger.log(`📋 [SeedCampaignTriggerService] Found existing triggers: ${existingTriggers.join(', ') || 'none'}`);
    return {
      hasAll,
      triggers: existingTriggers
    };
  }

  private async dropExistingTriggers(existingTriggers: string[]) {
    // Drop all 6 triggers if they exist
    const allPossibleTriggers = [
      'campaigns_after_insert', 'campaigns_after_update',
      'campaign_interaction_logs_after_insert', 'campaign_interaction_logs_after_update',
      'campaign_schedules_after_insert', 'campaign_schedules_after_update'
    ];
    for (const triggerName of allPossibleTriggers) {
      try {
        await this.dataSource.query(`DROP TRIGGER \`${triggerName}\``);
        this.logger.log(`🗑️ [SeedCampaignTriggerService] Dropped trigger: ${triggerName}`);
      } catch (error) {
        if (!error.message.includes("doesn't exist")) {
          this.logger.warn(`⚠️ [SeedCampaignTriggerService] Warning dropping trigger ${triggerName}: ${error.message}`);
        }
      }
      await new Promise(res => setTimeout(res, 100));
    }
  }

  private async createTriggers(existingTriggers: string[] = []) {
    const triggers = [
      { name: 'campaigns_after_insert', sql: this.getCampaignsInsertTrigger() },
      { name: 'campaigns_after_update', sql: this.getCampaignsUpdateTrigger() },
      { name: 'campaign_interaction_logs_after_insert', sql: this.getCampaignInteractionLogsInsertTrigger() },
      { name: 'campaign_interaction_logs_after_update', sql: this.getCampaignInteractionLogsUpdateTrigger() },
      { name: 'campaign_schedules_after_insert', sql: this.getCampaignSchedulesInsertTrigger() },
      { name: 'campaign_schedules_after_update', sql: this.getCampaignSchedulesUpdateTrigger() }
    ];
    for (const trigger of triggers) {
      try {
        await this.dataSource.query(trigger.sql);
        this.logger.log(`✅ [SeedCampaignTriggerService] Created trigger: ${trigger.name}`);
      } catch (error) {
        this.logger.error(`❌ [SeedCampaignTriggerService] Failed to create trigger ${trigger.name}: ${error.message}`);
        throw error;
      }
    }
  }

  // ===== CAMPAIGNS TABLE TRIGGERS =====
  private getCampaignsInsertTrigger(): string {
    return `
      CREATE TRIGGER \`campaigns_after_insert\` 
      AFTER INSERT ON \`campaigns\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'campaigns', NEW.id, 'INSERT', 
          JSON_OBJECT(
            'id', NEW.id,
            'name', NEW.name,
            'campaign_type', NEW.campaign_type,
            'status', NEW.status,
            'send_method', NEW.send_method,
            'department_id', NEW.department_id,
            'created_by_id', NEW.created_by_id,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          ),
          NOW()
        );
      END
    `;
  }

  private getCampaignsUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`campaigns_after_update\` 
      AFTER UPDATE ON \`campaigns\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();
        
        -- Only track specific allowed fields for campaigns
        -- status: Critical campaign lifecycle status
        IF OLD.status != NEW.status THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'status');
        END IF;
        
        -- Only log if there are actual changes to tracked fields
        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'campaigns', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'name', OLD.name,
              'campaign_type', OLD.campaign_type,
              'status', OLD.status,
              'send_method', OLD.send_method,
              'department_id', OLD.department_id,
              'created_by_id', OLD.created_by_id,
              'updated_at', OLD.updated_at
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'name', NEW.name,
              'campaign_type', NEW.campaign_type,
              'status', NEW.status,
              'send_method', NEW.send_method,
              'department_id', NEW.department_id,
              'created_by_id', NEW.created_by_id,
              'updated_at', NEW.updated_at
            ),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }

  // ===== CAMPAIGN_INTERACTION_LOGS TABLE TRIGGERS =====
  private getCampaignInteractionLogsInsertTrigger(): string {
    return `
      CREATE TRIGGER \`campaign_interaction_logs_after_insert\` 
      AFTER INSERT ON \`campaign_interaction_logs\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'campaign_interaction_logs', NEW.id, 'INSERT',
          JSON_OBJECT(
            'id', NEW.id,
            'campaign_id', NEW.campaign_id,
            'customer_id', NEW.customer_id,
            'message_content_sent', NEW.message_content_sent,
            'attachment_sent', NEW.attachment_sent,
            'status', NEW.status,
            'sent_at', NEW.sent_at,
            'customer_replied_at', NEW.customer_replied_at,
            'customer_reply_content', NEW.customer_reply_content,
            'staff_handled_at', NEW.staff_handled_at,
            'staff_reply_content', NEW.staff_reply_content,
            'staff_handler_id', NEW.staff_handler_id,
            'error_details', NEW.error_details,
            'conversation_metadata', NEW.conversation_metadata,
            'reminder_metadata', NEW.reminder_metadata,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          ),
          NOW()
        );
      END
    `;
  }

  private getCampaignInteractionLogsUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`campaign_interaction_logs_after_update\` 
      AFTER UPDATE ON \`campaign_interaction_logs\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();
        
        -- Track all specified fields for campaign interaction logs
        
        -- message_content_sent: Message content sent to customer
        IF OLD.message_content_sent != NEW.message_content_sent OR (OLD.message_content_sent IS NULL AND NEW.message_content_sent IS NOT NULL) OR (OLD.message_content_sent IS NOT NULL AND NEW.message_content_sent IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'message_content_sent');
        END IF;
        
        -- attachment_sent: Attachments sent to customer
        IF JSON_UNQUOTE(OLD.attachment_sent) != JSON_UNQUOTE(NEW.attachment_sent) OR (OLD.attachment_sent IS NULL AND NEW.attachment_sent IS NOT NULL) OR (OLD.attachment_sent IS NOT NULL AND NEW.attachment_sent IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'attachment_sent');
        END IF;
        
        -- status: Interaction log status
        IF OLD.status != NEW.status THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'status');
        END IF;
        
        -- sent_at: Message sent timestamp
        IF OLD.sent_at != NEW.sent_at OR (OLD.sent_at IS NULL AND NEW.sent_at IS NOT NULL) OR (OLD.sent_at IS NOT NULL AND NEW.sent_at IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'sent_at');
        END IF;
        
        -- customer_replied_at: Customer reply timestamp
        IF OLD.customer_replied_at != NEW.customer_replied_at OR (OLD.customer_replied_at IS NULL AND NEW.customer_replied_at IS NOT NULL) OR (OLD.customer_replied_at IS NOT NULL AND NEW.customer_replied_at IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'customer_replied_at');
        END IF;
        
        -- customer_reply_content: Customer reply content
        IF OLD.customer_reply_content != NEW.customer_reply_content OR (OLD.customer_reply_content IS NULL AND NEW.customer_reply_content IS NOT NULL) OR (OLD.customer_reply_content IS NOT NULL AND NEW.customer_reply_content IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'customer_reply_content');
        END IF;
        
        -- staff_handled_at: Staff handling timestamp
        IF OLD.staff_handled_at != NEW.staff_handled_at OR (OLD.staff_handled_at IS NULL AND NEW.staff_handled_at IS NOT NULL) OR (OLD.staff_handled_at IS NOT NULL AND NEW.staff_handled_at IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'staff_handled_at');
        END IF;
        
        -- staff_reply_content: Staff reply content
        IF OLD.staff_reply_content != NEW.staff_reply_content OR (OLD.staff_reply_content IS NULL AND NEW.staff_reply_content IS NOT NULL) OR (OLD.staff_reply_content IS NOT NULL AND NEW.staff_reply_content IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'staff_reply_content');
        END IF;
        
        -- conversation_metadata: Conversation metadata
        IF JSON_UNQUOTE(OLD.conversation_metadata) != JSON_UNQUOTE(NEW.conversation_metadata) OR (OLD.conversation_metadata IS NULL AND NEW.conversation_metadata IS NOT NULL) OR (OLD.conversation_metadata IS NOT NULL AND NEW.conversation_metadata IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'conversation_metadata');
        END IF;
        
        -- Only log if there are actual changes to tracked fields
        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'campaign_interaction_logs', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'campaign_id', OLD.campaign_id,
              'customer_id', OLD.customer_id,
              'message_content_sent', OLD.message_content_sent,
              'attachment_sent', OLD.attachment_sent,
              'status', OLD.status,
              'sent_at', OLD.sent_at,
              'customer_replied_at', OLD.customer_replied_at,
              'customer_reply_content', OLD.customer_reply_content,
              'staff_handled_at', OLD.staff_handled_at,
              'staff_reply_content', OLD.staff_reply_content,
              'staff_handler_id', OLD.staff_handler_id,
              'conversation_metadata', OLD.conversation_metadata,
              'updated_at', OLD.updated_at
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'campaign_id', NEW.campaign_id,
              'customer_id', NEW.customer_id,
              'message_content_sent', NEW.message_content_sent,
              'attachment_sent', NEW.attachment_sent,
              'status', NEW.status,
              'sent_at', NEW.sent_at,
              'customer_replied_at', NEW.customer_replied_at,
              'customer_reply_content', NEW.customer_reply_content,
              'staff_handled_at', NEW.staff_handled_at,
              'staff_reply_content', NEW.staff_reply_content,
              'staff_handler_id', NEW.staff_handler_id,
              'conversation_metadata', NEW.conversation_metadata,
              'updated_at', NEW.updated_at
            ),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }

  // ===== CAMPAIGN_SCHEDULES TABLE TRIGGERS =====
  private getCampaignSchedulesInsertTrigger(): string {
    return `
      CREATE TRIGGER \`campaign_schedules_after_insert\` 
      AFTER INSERT ON \`campaign_schedules\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'campaign_schedules', NEW.id, 'INSERT',
          JSON_OBJECT(
            'id', NEW.id,
            'campaign_id', NEW.campaign_id,
            'schedule_config', NEW.schedule_config,
            'is_active', NEW.is_active,
            'start_date', NEW.start_date,
            'end_date', NEW.end_date,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          ),
          NOW()
        );
      END
    `;
  }

  private getCampaignSchedulesUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`campaign_schedules_after_update\` 
      AFTER UPDATE ON \`campaign_schedules\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();
        
        -- Only track specific allowed fields for campaign schedules
        
        -- start_date: Campaign start date
        IF OLD.start_date != NEW.start_date OR (OLD.start_date IS NULL AND NEW.start_date IS NOT NULL) OR (OLD.start_date IS NOT NULL AND NEW.start_date IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'start_date');
        END IF;
        
        -- end_date: Campaign end date
        IF OLD.end_date != NEW.end_date OR (OLD.end_date IS NULL AND NEW.end_date IS NOT NULL) OR (OLD.end_date IS NOT NULL AND NEW.end_date IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'end_date');
        END IF;
        
        -- Only log if there are actual changes to tracked fields
        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'campaign_schedules', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'campaign_id', OLD.campaign_id,
              'schedule_config', OLD.schedule_config,
              'is_active', OLD.is_active,
              'start_date', OLD.start_date,
              'end_date', OLD.end_date,
              'updated_at', OLD.updated_at
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'campaign_id', NEW.campaign_id,
              'schedule_config', NEW.schedule_config,
              'is_active', NEW.is_active,
              'start_date', NEW.start_date,
              'end_date', NEW.end_date,
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
    this.logger.log('🔄 [SeedCampaignTriggerService] Manually recreating all campaign triggers...');
    // Drop all triggers
    const existingTriggersResult = await this.checkExistingTriggers();
    await this.dropExistingTriggers(existingTriggersResult.triggers);
    // Create new triggers
    await this.createTriggers([]);
    this.logger.log('✅ [SeedCampaignTriggerService] All campaign triggers recreated successfully!');
  }

  async dropAllTriggers() {
    this.logger.log('🗑️ [SeedCampaignTriggerService] Dropping all campaign triggers...');
    
    const existingTriggers = await this.checkExistingTriggers();
    await this.dropExistingTriggers(existingTriggers.triggers);
    
    this.logger.log('✅ [SeedCampaignTriggerService] All campaign triggers dropped successfully!');
  }

  async getTriggersStatus() {
    const existingTriggers = await this.checkExistingTriggers();
    return {
      hasAllTriggers: existingTriggers.hasAll,
      existingTriggers: existingTriggers.triggers,
      expectedTriggers: [
        'campaigns_after_insert', 'campaigns_after_update',
        'campaign_interaction_logs_after_insert', 'campaign_interaction_logs_after_update',
        'campaign_schedules_after_insert', 'campaign_schedules_after_update'
      ],
      allowedTrackingFields: this.ALLOWED_TRACKING_FIELDS
    };
  }

  /**
   * Create triggers with strict field whitelisting
   * Only specified fields will be tracked for changes
   */
  async createSelectiveTriggers(tableFieldConfig?: {
    campaigns?: string[];
    campaign_interaction_logs?: string[];
    campaign_schedules?: string[];
  }) {
    this.logger.log('🎯 [SeedCampaignTriggerService] Creating selective campaign triggers (insert & update) with field whitelisting...');
    const config = tableFieldConfig || this.ALLOWED_TRACKING_FIELDS;
    const existingTriggers = await this.checkExistingTriggers();
    if (existingTriggers.triggers.length > 0) {
      await this.dropExistingTriggers(existingTriggers.triggers);
      await new Promise(res => setTimeout(res, 300));
    }
    const tables = ['campaigns', 'campaign_interaction_logs', 'campaign_schedules'] as const;
    for (const tableName of tables) {
      const allowedFields = config[tableName] || [];
      if (allowedFields.length === 0) {
        this.logger.warn(`⚠️ [SeedCampaignTriggerService] No allowed fields specified for ${tableName}, skipping trigger creation`);
        continue;
      }
      this.logger.log(`📋 [SeedCampaignTriggerService] Creating triggers for ${tableName} (insert & update) with fields: ${allowedFields.join(', ')}`);
      // Insert trigger
      let insertTriggerSQL: string;
      let updateTriggerSQL: string;
      switch (tableName) {
        case 'campaigns':
          insertTriggerSQL = this.getCampaignsInsertTrigger();
          updateTriggerSQL = this.getCampaignsUpdateTrigger();
          break;
        case 'campaign_interaction_logs':
          insertTriggerSQL = this.getCampaignInteractionLogsInsertTrigger();
          updateTriggerSQL = this.getCampaignInteractionLogsUpdateTrigger();
          break;
        case 'campaign_schedules':
          insertTriggerSQL = this.getCampaignSchedulesInsertTrigger();
          updateTriggerSQL = this.getCampaignSchedulesUpdateTrigger();
          break;
        default:
          continue;
      }
      try {
        await this.dataSource.query(insertTriggerSQL);
        this.logger.log(`✅ [SeedCampaignTriggerService] Created selective trigger: ${tableName}_after_insert`);
        await this.dataSource.query(updateTriggerSQL);
        this.logger.log(`✅ [SeedCampaignTriggerService] Created selective trigger: ${tableName}_after_update`);
      } catch (error) {
        this.logger.error(`❌ [SeedCampaignTriggerService] Failed to create selective triggers for ${tableName}: ${error.message}`);
        throw error;
      }
    }
    this.logger.log('🎯 [SeedCampaignTriggerService] Selective campaign triggers (insert & update) created successfully!');
  }

  /**
   * Validate if a field is allowed to be tracked
   */
  public isFieldAllowedForTracking(tableName: keyof typeof this.ALLOWED_TRACKING_FIELDS, fieldName: string): boolean {
    return this.ALLOWED_TRACKING_FIELDS[tableName]?.includes(fieldName) || false;
  }
}
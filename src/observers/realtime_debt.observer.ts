import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { DebtLogs, ReminderStatus } from '../debt_logs/debt_logs.entity';
import { DebtConfig } from '../debt_configs/debt_configs.entity';
import { Debt } from '../debts/debt.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { ChangeAction, DatabaseChangeLog } from './change_log.entity';

@Injectable()
export class RealTimeDebtObserver implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealTimeDebtObserver.name);
  private isRunning = false;
  private processingInterval: NodeJS.Timeout;
  private lastProcessedId = 0;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly websocketGateway: WebsocketGateway,
    @InjectRepository(DatabaseChangeLog)
    private readonly changeLogRepo: Repository<DatabaseChangeLog>,
    @InjectRepository(DebtLogs)
    private readonly debtLogRepo: Repository<DebtLogs>,
    @InjectRepository(DebtConfig)
    private readonly debtConfigRepo: Repository<DebtConfig>,
    @InjectRepository(Debt)
    private readonly debtRepo: Repository<Debt>,
  ) {}

  async onModuleInit() {
    this.logger.log(
      '🚀 [RealTimeDebtObserver] Starting real-time monitoring...',
    );

    // Get last processed ID từ database
    const lastLog = await this.changeLogRepo.findOne({
      where: { processed: true },
      order: { id: 'DESC' },
    });

    if (lastLog) {
      this.lastProcessedId = lastLog.id;
    }

    this.isRunning = true;
    this.startProcessing();

    this.logger.log('✅ [RealTimeDebtObserver] Real-time monitoring started');
  }

  async onModuleDestroy() {
    this.isRunning = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    this.logger.log('🛑 [RealTimeDebtObserver] Stopped');
  }

  private startProcessing() {
    // Check for new changes every 500ms (much faster than 10s polling)
    this.processingInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        await this.processNewChanges();
      } catch (error) {
        this.logger.error(`Error processing changes: ${error.message}`);
      }
    }, 500);
  }

  private async processNewChanges() {
    // Get unprocessed changes
    const newChanges = await this.changeLogRepo.find({
      where: {
        id: MoreThan(this.lastProcessedId),
        processed: false,
      },
      order: { id: 'ASC' },
      take: 50, // Process max 50 changes per batch
    });

    if (newChanges.length === 0) return;

    this.logger.log(
      `📝 [RealTimeDebtObserver] Processing ${newChanges.length} new changes`,
    );

    for (const change of newChanges) {
      try {
        await this.processIndividualChange(change);

        // Mark as processed
        await this.changeLogRepo.update(change.id, {
          processed: true,
          processed_at: new Date(),
        });

        this.lastProcessedId = change.id;
      } catch (error) {
        this.logger.error(
          `Error processing change ${change.id}: ${error.message}`,
        );
      }
    }
  }

  private async processIndividualChange(change: DatabaseChangeLog) {
    const {
      table_name,
      record_id,
      action,
      old_values,
      new_values,
      changed_fields,
    } = change;

    this.logger.log(`[RealTimeDebtObserver] Processing table: ${table_name}`);

    if (table_name === 'debt_logs') {
      await this.handleDebtLogChange(
        record_id,
        action,
        old_values,
        new_values,
        changed_fields,
      );
    } else if (table_name === 'debt_configs') {
      await this.handleDebtConfigChange(
        record_id,
        action,
        old_values,
        new_values,
        changed_fields,
      );
    } else if (table_name === 'debts') {
      await this.handleDebtChange(
        record_id,
        action,
        old_values,
        new_values,
        changed_fields,
      );
    }
  }

  private async handleDebtLogChange(
    recordId: number,
    action: ChangeAction,
    oldValues: any,
    newValues: any,
    changedFields: string[],
  ) {
    this.logger.log(
      `📝 [RealTimeDebtObserver] DebtLog ${recordId} ${action}: ${changedFields?.join(', ')}`,
    );

    // Get full entity với relations
    const debtLog = await this.debtLogRepo.findOne({
      where: { id: recordId },
      relations: ['debt_config'],
    });

    if (!debtLog) {
      this.logger.warn(`DebtLog ${recordId} not found`);
      return;
    }

    // Create standardized change object
    const changes = this.createChangeObject(
      oldValues,
      newValues,
      changedFields,
    );

    // Emit event
    const dbEvent = {
      entity: 'debt_logs' as const,
      action,
      entityId: recordId,
      changes,
      timestamp: new Date(),
      triggeredBy: 'database' as const,
    };

    this.eventEmitter.emit('database.change', dbEvent);

    // Auto-sync logic
    await this.syncDebtLogToConfig(debtLog, changes);

    // Broadcast to WebSocket
    this.websocketGateway.emitToRoom(
      'department:cong-no',
      'debt_log_realtime_updated',
      {
        type: 'debt_log_updated',
        entity_id: recordId,
        debt_config_id: debtLog.debt_config_id,
        customer_code: debtLog.debt_config?.customer_code,
        changes,
        timestamp: new Date(),
        triggered_by: 'database',
        refresh_request: true,
      },
    );
  }

  private async handleDebtConfigChange(
    recordId: number,
    action: ChangeAction,
    oldValues: any,
    newValues: any,
    changedFields: string[],
  ) {
    this.logger.log(
      `⚙️ [RealTimeDebtObserver] DebtConfig ${recordId} ${action}: ${changedFields?.join(', ')}`,
    );

    // Get full entity với relations
    const debtConfig = await this.debtConfigRepo.findOne({
      where: { id: recordId },
      relations: ['debt_log'],
    });

    if (!debtConfig) {
      this.logger.warn(`DebtConfig ${recordId} not found`);
      return;
    }

    // Create standardized change object
    const changes = this.createChangeObject(
      oldValues,
      newValues,
      changedFields,
    );

    // Emit event
    const dbEvent = {
      entity: 'debt_configs' as const,
      action,
      entityId: recordId,
      changes,
      timestamp: new Date(),
      triggeredBy: 'database' as const,
    };

    this.eventEmitter.emit('database.change', dbEvent);

    // Auto-sync logic
    await this.syncDebtConfigToLog(debtConfig, changes);

    // Broadcast to WebSocket
    this.websocketGateway.emitToRoom(
      'department:cong-no',
      'debt_config_realtime_updated',
      {
        type: 'debt_config_updated',
        refresh_request: true,
      },
    );
  }

  private async handleDebtChange(
    recordId: number,
    action: ChangeAction,
    oldValues: any,
    newValues: any,
    changedFields: string[],
  ) {
    this.logger.log(
      `💰 [RealTimeDebtObserver] Debt ${recordId} ${action}: ${changedFields?.join(', ')}`,
    );

    // Get full entity với relations
    const debt = await this.debtRepo.findOne({
      where: { id: recordId },
    });

    if (!debt) {
      this.logger.warn(`Debt ${recordId} not found`);
      return;
    }

    // Create standardized change object
    const changes = this.createChangeObject(
      oldValues,
      newValues,
      changedFields,
    );

    // Emit event
    const dbEvent = {
      entity: 'debts' as const,
      action,
      entityId: recordId,
      changes,
      timestamp: new Date(),
      triggeredBy: 'database' as const,
    };

    this.eventEmitter.emit('database.change', dbEvent);

    // Broadcast to WebSocket
    this.websocketGateway.emitToRoom(
      'department:cong-no',
      'debt_realtime_updated',
      {
        type: 'debt_updated',
        refresh_request: true,
      },
    );
  }

  private createChangeObject(
    oldValues: any,
    newValues: any,
    changedFields: string[],
  ): any {
    const changes: any = {};

    if (changedFields && changedFields.length > 0) {
      for (const field of changedFields) {
        changes[field] = {
          old: oldValues?.[field],
          new: newValues?.[field],
        };
      }
    }

    return changes;
  }

  private async syncDebtLogToConfig(debtLog: DebtLogs, changes: any) {
    try {
      const updates: Partial<DebtConfig> = {};

      // Sync send_at changes
      if (changes.send_at && changes.send_at.new) {
        updates.send_last_at = new Date(changes.send_at.new);
      }
    } catch (error) {
      this.logger.error(`Failed to sync debt_log to config: ${error.message}`);
    }
  }

  private async syncDebtConfigToLog(debtConfig: DebtConfig, changes: any) {
    try {
      const updates: Partial<DebtLogs> = {};

      if (changes.send_last_at && changes.send_last_at.new) {
        updates.send_at = new Date(changes.send_last_at.new);
      }
    } catch (error) {
      this.logger.error(`Failed to sync debt_config to log: ${error.message}`);
    }
  }

  // Public methods
  async getStatus() {
    const unprocessedCount = await this.changeLogRepo.count({
      where: { processed: false },
    });

    return {
      isRunning: this.isRunning,
      lastProcessedId: this.lastProcessedId,
      unprocessedChanges: unprocessedCount,
    };
  }

  async forceProcessAll() {
    this.logger.log(
      '🔄 [RealTimeDebtObserver] Force processing all unprocessed changes...',
    );
    this.lastProcessedId = 0; // Reset to process all
    await this.processNewChanges();
  }
}

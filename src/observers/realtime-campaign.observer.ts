import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { Campaign } from '../campaigns/campaign.entity';
import { CampaignInteractionLog } from '../campaign_interaction_logs/campaign_interaction_log.entity';
import { CampaignSchedule } from '../campaign_schedules/campaign_schedule.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { ChangeAction, DatabaseChangeLog } from './change_log.entity';

@Injectable()
export class RealTimeCampaignObserver implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealTimeCampaignObserver.name);
  private isRunning = false;
  private processingInterval: NodeJS.Timeout;
  private lastProcessedId = 0;

  // Separate debounce queues for each ws_type
  private wsEventQueueCampaign: any[] = [];
  private wsDebounceTimerCampaign: NodeJS.Timeout | null = null;
  private wsEventQueueInteractionLog: any[] = [];
  private wsDebounceTimerInteractionLog: NodeJS.Timeout | null = null;
  private wsEventQueueSchedule: any[] = [];
  private wsDebounceTimerSchedule: NodeJS.Timeout | null = null;
  private readonly WS_DEBOUNCE_MS = 2000;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly websocketGateway: WebsocketGateway,
    @InjectRepository(DatabaseChangeLog)
    private readonly changeLogRepo: Repository<DatabaseChangeLog>,
    @InjectRepository(Campaign)
    private readonly campaignRepo: Repository<Campaign>,
    @InjectRepository(CampaignInteractionLog)
    private readonly campaignInteractionLogRepo: Repository<CampaignInteractionLog>,
    @InjectRepository(CampaignSchedule)
    private readonly campaignScheduleRepo: Repository<CampaignSchedule>,
  ) {}

  async onModuleInit() {
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
  }

  async onModuleDestroy() {
    this.isRunning = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
  }

  private startProcessing() {
    // Check for new changes every 500ms (much faster than 10s polling)
    this.processingInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        await this.processNewChanges();
      } catch (error) {
        this.logger.error(
          `Error processing campaign changes: ${error.message}`,
        );
      }
    }, 500);
  }

  private async processNewChanges() {
    // Get unprocessed changes for campaign tables only
    const newChanges = await this.changeLogRepo
      .createQueryBuilder('change_log')
      .where('change_log.id > :lastProcessedId', {
        lastProcessedId: this.lastProcessedId,
      })
      .andWhere('change_log.processed = false')
      .andWhere('change_log.table_name IN (:...tableNames)', {
        tableNames: [
          'campaigns',
          'campaign_interaction_logs',
          'campaign_schedules',
        ],
      })
      .orderBy('change_log.id', 'ASC')
      .limit(50) // Process max 50 changes per batch
      .getMany();

    if (newChanges.length === 0) return;

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
          `Error processing campaign change ${change.id}: ${error.message}`,
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

    if (table_name === 'campaigns') {
      await this.handleCampaignChange(
        record_id,
        action,
        old_values,
        new_values,
        changed_fields,
      );
    } else if (table_name === 'campaign_interaction_logs') {
      await this.handleCampaignInteractionLogChange(
        record_id,
        action,
        old_values,
        new_values,
        changed_fields,
      );
    } else if (table_name === 'campaign_schedules') {
      await this.handleCampaignScheduleChange(
        record_id,
        action,
        old_values,
        new_values,
        changed_fields,
      );
    }
  }

  private async handleCampaignChange(
    recordId: number,
    action: ChangeAction,
    oldValues: any,
    newValues: any,
    changedFields: string[],
  ) {
    // Get full entity với relations
    const campaign = await this.campaignRepo.findOne({
      where: { id: recordId.toString() },
      relations: ['department', 'created_by'],
    });

    if (!campaign) {
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
      entity: 'campaigns' as const,
      action,
      entityId: recordId,
      changes,
      timestamp: new Date(),
      triggeredBy: 'database' as const,
    };

    this.eventEmitter.emit('database.change', dbEvent);

    // Auto-sync logic for campaigns if needed
    await this.syncCampaignData(campaign, changes);

    // Push event to ws queue (debounce)
    this.pushWsEvent({
      ws_type: 'campaign_realtime_updated',
      type: action === ChangeAction.INSERT ? 'insert' : 'campaign_updated',
      entity_id: recordId,
      campaign_id: recordId,
      campaign_name: campaign.name,
      campaign_status: campaign.status,
      department_id: campaign.department?.id,
      changes,
      timestamp: new Date(),
      triggered_by: 'database',
      refresh_request: true,
    });
  }

  private async handleCampaignInteractionLogChange(
    recordId: number,
    action: ChangeAction,
    oldValues: any,
    newValues: any,
    changedFields: string[],
  ) {
    // Get full entity với relations
    const interactionLog = await this.campaignInteractionLogRepo.findOne({
      where: { id: recordId.toString() },
      relations: ['campaign', 'customer', 'staff_handler'],
    });

    if (!interactionLog) {
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
      entity: 'campaign_interaction_logs' as const,
      action,
      entityId: recordId,
      changes,
      timestamp: new Date(),
      triggeredBy: 'database' as const,
    };

    this.eventEmitter.emit('database.change', dbEvent);

    // Auto-sync logic for interaction logs if needed
    await this.syncInteractionLogData(interactionLog, changes);

    // Push event to ws queue (debounce)
    this.pushWsEvent({
      ws_type: 'campaign_interaction_log_realtime_updated',
      type:
        action === ChangeAction.INSERT ? 'insert' : 'interaction_log_updated',
      entity_id: recordId,
      campaign_id: interactionLog.campaign?.id,
      customer_id: interactionLog.customer?.id,
      interaction_status: interactionLog.status,
      changes,
      timestamp: new Date(),
      triggered_by: 'database',
      refresh_request: true,
    });
  }

  private async handleCampaignScheduleChange(
    recordId: number,
    action: ChangeAction,
    oldValues: any,
    newValues: any,
    changedFields: string[],
  ) {
    // Get full entity với relations
    const schedule = await this.campaignScheduleRepo.findOne({
      where: { id: recordId.toString() },
      relations: ['campaign'],
    });

    if (!schedule) {
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
      entity: 'campaign_schedules' as const,
      action,
      entityId: recordId,
      changes,
      timestamp: new Date(),
      triggeredBy: 'database' as const,
    };

    this.eventEmitter.emit('database.change', dbEvent);

    // Auto-sync logic for schedules if needed
    await this.syncScheduleData(schedule, changes);

    // Push event to ws queue (debounce)
    this.pushWsEvent({
      ws_type: 'campaign_schedule_realtime_updated',
      type: action === ChangeAction.INSERT ? 'insert' : 'schedule_updated',
      entity_id: recordId,
      campaign_id: schedule.campaign?.id,
      is_active: schedule.is_active,
      start_date: schedule.start_date,
      end_date: schedule.end_date,
      changes,
      timestamp: new Date(),
      triggered_by: 'database',
      refresh_request: true,
    });
  }

  /**
   * Push event to the correct ws queue and debounce send
   */
  private pushWsEvent(event: any) {
    if (event.ws_type === 'campaign_realtime_updated') {
      this.wsEventQueueCampaign.push(event);
      if (this.wsDebounceTimerCampaign) {
        clearTimeout(this.wsDebounceTimerCampaign);
      }
      this.wsDebounceTimerCampaign = setTimeout(
        () => this.flushWsEventsCampaign(),
        this.WS_DEBOUNCE_MS,
      );
    } else if (event.ws_type === 'campaign_interaction_log_realtime_updated') {
      this.wsEventQueueInteractionLog.push(event);
      if (this.wsDebounceTimerInteractionLog) {
        clearTimeout(this.wsDebounceTimerInteractionLog);
      }
      this.wsDebounceTimerInteractionLog = setTimeout(
        () => this.flushWsEventsInteractionLog(),
        this.WS_DEBOUNCE_MS,
      );
    } else if (event.ws_type === 'campaign_schedule_realtime_updated') {
      this.wsEventQueueSchedule.push(event);
      if (this.wsDebounceTimerSchedule) {
        clearTimeout(this.wsDebounceTimerSchedule);
      }
      this.wsDebounceTimerSchedule = setTimeout(
        () => this.flushWsEventsSchedule(),
        this.WS_DEBOUNCE_MS,
      );
    } else {
      // fallback: push to campaign queue
      this.wsEventQueueCampaign.push(event);
      if (this.wsDebounceTimerCampaign) {
        clearTimeout(this.wsDebounceTimerCampaign);
      }
      this.wsDebounceTimerCampaign = setTimeout(
        () => this.flushWsEventsCampaign(),
        this.WS_DEBOUNCE_MS,
      );
    }
  }

  /**
   * Flush campaign events
   */
  private flushWsEventsCampaign() {
    if (this.wsEventQueueCampaign.length > 0) {
      const wsType =
        this.wsEventQueueCampaign[0].ws_type ||
        'campaign_batch_realtime_updated';
      this.websocketGateway.emitToRoom(
        'department:chien-dich', // Phòng ban chiến dịch
        wsType,
        { events: this.wsEventQueueCampaign, refresh_request: true },
      );
      this.wsEventQueueCampaign = [];
    }
    if (this.wsDebounceTimerCampaign) {
      clearTimeout(this.wsDebounceTimerCampaign);
      this.wsDebounceTimerCampaign = null;
    }
  }

  /**
   * Flush interaction log events
   */
  private flushWsEventsInteractionLog() {
    if (this.wsEventQueueInteractionLog.length > 0) {
      const wsType =
        this.wsEventQueueInteractionLog[0].ws_type ||
        'campaign_interaction_log_realtime_updated';
      this.websocketGateway.emitToRoom(
        'department:chien-dich', // Phòng ban chiến dịch
        wsType,
        { events: this.wsEventQueueInteractionLog, refresh_request: true },
      );
      this.wsEventQueueInteractionLog = [];
    }
    if (this.wsDebounceTimerInteractionLog) {
      clearTimeout(this.wsDebounceTimerInteractionLog);
      this.wsDebounceTimerInteractionLog = null;
    }
  }

  /**
   * Flush schedule events
   */
  private flushWsEventsSchedule() {
    if (this.wsEventQueueSchedule.length > 0) {
      const wsType =
        this.wsEventQueueSchedule[0].ws_type ||
        'campaign_schedule_realtime_updated';
      this.websocketGateway.emitToRoom(
        'department:chien-dich', // Phòng ban chiến dịch
        wsType,
        { events: this.wsEventQueueSchedule, refresh_request: true },
      );
      this.wsEventQueueSchedule = [];
    }
    if (this.wsDebounceTimerSchedule) {
      clearTimeout(this.wsDebounceTimerSchedule);
      this.wsDebounceTimerSchedule = null;
    }
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

  private async syncCampaignData(campaign: Campaign, changes: any) {
    try {
      // Custom sync logic for campaigns
      // Example: When campaign status changes, might need to update related schedules
      if (changes.status) {

        // Add any automatic sync logic here
        // For example: if campaign becomes inactive, pause all schedules
        if (
          changes.status.new === 'paused' ||
          changes.status.new === 'cancelled'
        ) {
          // Could automatically update related schedules
        }
      }
    } catch (error) {
      this.logger.error(`Failed to sync campaign data: ${error.message}`);
    }
  }

  private async syncInteractionLogData(
    interactionLog: CampaignInteractionLog,
    changes: any,
  ) {
    try {
      // Custom sync logic for interaction logs
      // Example: When customer replies, update campaign stats
      if (changes.customer_replied_at && changes.customer_replied_at.new) {

        // Add any automatic sync logic here
        // For example: update campaign response rates
      }

      // Example: When staff handles interaction, update performance metrics
      if (changes.staff_handled_at && changes.staff_handled_at.new) {

        // Add any automatic sync logic here
      }
    } catch (error) {
      this.logger.error(
        `Failed to sync interaction log data: ${error.message}`,
      );
    }
  }

  private async syncScheduleData(schedule: CampaignSchedule, changes: any) {
    try {
      // Custom sync logic for schedules
      // Example: When schedule dates change, validate campaign timeline
      if (changes.start_date || changes.end_date) {
        // Add any automatic sync logic here
        // For example: validate that start_date < end_date
        // Or update campaign status based on schedule changes
      }
    } catch (error) {
      this.logger.error(`Failed to sync schedule data: ${error.message}`);
    }
  }

  // Public methods
  async getStatus() {
    const unprocessedCount = await this.changeLogRepo.count({
      where: {
        processed: false,
        table_name: [
          'campaigns',
          'campaign_interaction_logs',
          'campaign_schedules',
        ] as any,
      },
    });

    return {
      isRunning: this.isRunning,
      lastProcessedId: this.lastProcessedId,
      unprocessedCampaignChanges: unprocessedCount,
      queueSizes: {
        campaign: this.wsEventQueueCampaign.length,
        interactionLog: this.wsEventQueueInteractionLog.length,
        schedule: this.wsEventQueueSchedule.length,
      },
    };
  }

  async forceProcessAll() {
    this.lastProcessedId = 0; // Reset to process all
    await this.processNewChanges();
  }

  async flushAllQueues() {
    this.flushWsEventsCampaign();
    this.flushWsEventsInteractionLog();
    this.flushWsEventsSchedule();
  }
}

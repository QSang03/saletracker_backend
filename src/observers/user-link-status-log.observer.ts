import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { Repository } from 'typeorm';
import { DatabaseChangeLog, ChangeAction } from './change_log.entity';
import { UserStatusChangeEvent } from './user-status.observer';

@Injectable()
export class UserLinkStatusLogObserver {
  private readonly logger = new Logger('UserLinkStatusLogObserver');

  constructor(
    @InjectRepository(DatabaseChangeLog)
    private readonly changeLogRepo: Repository<DatabaseChangeLog>,
    private readonly wsGateway: WebsocketGateway,
  ) {}

  @OnEvent('user.status.changed')
  async handleUserStatusChanged(event: UserStatusChangeEvent) {
    try {
      if (event.oldStatus === event.newStatus) return; // no real change
      const log = this.changeLogRepo.create({
        table_name: 'users',
        record_id: event.userId,
        action: ChangeAction.UPDATE,
        old_values: { zalo_link_status: event.oldStatus },
        new_values: { zalo_link_status: event.newStatus },
        changed_fields: ['zalo_link_status'],
      });
      await this.changeLogRepo.save(log);
      // Emit websocket event to rooms or specific user
      try {
        this.wsGateway.emitToUser(String(event.userId), 'zalo_link_status:changed', {
          userId: event.userId,
          oldStatus: event.oldStatus,
          newStatus: event.newStatus,
          triggeredAt: new Date().toISOString(),
        });
      } catch (e) {
        this.logger.warn(`WS emit failed: ${e.message}`);
      }
    } catch (error) {
      this.logger.error('Failed to log zalo_link_status change', error.stack);
    }
  }
}

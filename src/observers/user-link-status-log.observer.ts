import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { UserStatusChangeEvent } from './user-status.observer';

@Injectable()
export class UserLinkStatusLogObserver {
  private readonly logger = new Logger('UserLinkStatusLogObserver');

  constructor(
    private readonly wsGateway: WebsocketGateway,
  ) {}

  @OnEvent('user.status.changed')
  async handleUserStatusChanged(event: UserStatusChangeEvent) {
    try {
      if (event.oldStatus === event.newStatus) return; // no real change
      
      // Không ghi log vào database nữa vì database trigger đã lo việc này
      // Chỉ xử lý WebSocket notification
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
      this.logger.error('Failed to handle zalo_link_status change notification', error.stack);
    }
  }
}

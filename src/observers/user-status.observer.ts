import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { UserGateway } from '../users/user.gateway';

export interface UserStatusChangeEvent {
  userId: number;
  oldStatus: number;
  newStatus: number;
  updatedBy: string;
  timestamp: Date;
}

@Injectable()
export class UserStatusObserver {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly userGateway: UserGateway,
  ) {}

  // Emit event khi user status thay đổi
  emitUserStatusChange(event: UserStatusChangeEvent) {
    this.eventEmitter.emit('user.status.changed', event);
  }

  // Lắng nghe event user status thay đổi
  @OnEvent('user.status.changed')
  async handleUserStatusChange(event: UserStatusChangeEvent) {
    console.log(
      `👁️ [UserStatusObserver] User ${event.userId} status changed from ${event.oldStatus} to ${event.newStatus}`,
    );

    // Nếu status được cập nhật thành 2 (lỗi liên kết Zalo)
    if (event.newStatus === 2) {
      console.log(
        `🔄 [UserStatusObserver] Requesting token refresh for user ${event.userId} due to Zalo link error`,
      );

      // Gửi socket event đến frontend yêu cầu refresh token
      this.userGateway.server
        .to(`user_${event.userId}`)
        .emit('force_token_refresh', {
          userId: event.userId,
          reason: 'zalo_link_error',
          message: 'Phiên đăng nhập cần được làm mới do lỗi liên kết Zalo',
          timestamp: event.timestamp,
        });

      // Gửi thông báo chung đến admin dashboard
      this.userGateway.server
        .to('admin_dashboard')
        .emit('user_zalo_link_error', {
          userId: event.userId,
          status: event.newStatus,
          updatedBy: event.updatedBy,
          timestamp: event.timestamp,
        });
    }
  }

  // Phương thức helper để trigger từ webhook hoặc service khác
  notifyUserStatusChange(
    userId: number,
    oldStatus: number,
    newStatus: number,
    updatedBy: string = 'webhook',
  ) {
    const event: UserStatusChangeEvent = {
      userId,
      oldStatus,
      newStatus,
      updatedBy,
      timestamp: new Date(),
    };

    this.emitUserStatusChange(event);
  }
}

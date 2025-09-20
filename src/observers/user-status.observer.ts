import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { UserGateway } from '../users/user.gateway';
import { UserService } from '../users/user.service';
import axios from 'axios';

export interface UserStatusChangeEvent {
  userId: number;
  oldStatus: number;
  newStatus: number;
  updatedBy: string;
  timestamp: Date;
}

@Injectable()
export class UserStatusObserver {
  private readonly logger = new Logger(UserStatusObserver.name);
  private readonly pythonApiUrl = process.env.CONTACTS_API_BASE_URL || 'http://192.168.117.19:5555';

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly userGateway: UserGateway,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
  ) {}

  // Emit event khi user status thay đổi
  emitUserStatusChange(event: UserStatusChangeEvent) {
    this.eventEmitter.emit('user.status.changed', event);
  }

  // Lắng nghe event user status thay đổi
  @OnEvent('user.status.changed')
  async handleUserStatusChange(event: UserStatusChangeEvent) {

    // Nếu status được cập nhật thành 2 (lỗi liên kết Zalo)
    if (event.newStatus === 2) {
      this.logger.log(`User ${event.userId} có lỗi liên kết Zalo, bắt đầu xử lý...`);

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

      // Gọi API Python để xử lý lỗi liên kết
      await this.callPythonApiForLinkError(event);
    }
  }

  // Gọi API Python để xử lý lỗi liên kết Zalo
  async callPythonApiForLinkError(event: UserStatusChangeEvent) {
    let payload: any;
    
    try {
      // Lấy thông tin chi tiết của user
      const user = await this.userService.findOneWithDetails(event.userId);
      
      if (!user) {
        this.logger.error(`Không tìm thấy user với ID: ${event.userId}`);
        return;
      }

      // Chuẩn bị dữ liệu gửi cho Python API
      payload = {
        userId: user.id,
        errorType: this.determineErrorType(event.oldStatus, event.newStatus),
        errorMessage: "Tài khoản đang lỗi liên kết",
        userInfo: {
          username: user.username,
          fullName: user.fullName,
          email: user.email,
          employeeCode: user.employeeCode || ''
        }
      };

      this.logger.log(`Gọi Python API cho user ${user.id}: ${JSON.stringify(payload)}`);
      this.logger.log(`Python API URL: ${this.pythonApiUrl}/send-error-notification`);
      this.logger.log(`EmployeeCode đã fix: "${user.employeeCode}" -> "${user.employeeCode || ''}"`);
      
      // Log X-Master-Key (ẩn một phần để bảo mật)
      const masterKey = process.env.NEXT_PUBLIC_MASTER_KEY || process.env.MASTER_KEY || '';
      const maskedKey = masterKey ? `${masterKey.substring(0, 4)}****${masterKey.substring(masterKey.length - 4)}` : 'Not configured';
      this.logger.log(`X-Master-Key: ${maskedKey}`);

      // Kiểm tra Contacts API URL
      if (!this.pythonApiUrl || this.pythonApiUrl === 'http://192.168.117.19:5555') {
        this.logger.log(`Đang sử dụng Contacts API URL: ${this.pythonApiUrl}`);
        this.logger.log(`Để thay đổi, cấu hình CONTACTS_API_BASE_URL trong .env file`);
      }

      // Gọi API Python
      const response = await axios.post(`${this.pythonApiUrl}/send-error-notification`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.PYTHON_API_TOKEN || ''}`,
          'X-Master-Key': process.env.NEXT_PUBLIC_MASTER_KEY || process.env.MASTER_KEY || ''
        },
        timeout: 10000 // 10 seconds timeout
      });

      const result = response.data;
      this.logger.log(`Python API response cho user ${user.id}: ${JSON.stringify(result)}`);

    } catch (error: any) {
      this.logger.error(`Lỗi khi gọi Python API cho user ${event.userId}: ${error.message}`);
      this.logger.error(`Error details: ${JSON.stringify(error)}`);
      
      // Log thêm thông tin về request
      this.logger.error(`Request URL: ${this.pythonApiUrl}/send-error-notification`);
      if (payload) {
        this.logger.error(`Request payload: ${JSON.stringify(payload)}`);
      }
      
      // Log response details nếu có
      if (error.response) {
        this.logger.error(`Response status: ${error.response.status}`);
        this.logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
        this.logger.error(`Response headers: ${JSON.stringify(error.response.headers)}`);
      }
      
      // Không throw error để không làm gián đoạn flow chính
    }
  }

  // Xác định loại lỗi dựa trên trạng thái cũ và mới
  private determineErrorType(oldStatus: number, newStatus: number): string {
    if (oldStatus === 1 && newStatus === 2) {
      return "session_invalid"; // Đang hoạt động bình thường nhưng bị lỗi
    } else if (oldStatus === 0 && newStatus === 2) {
      return "token_expired"; // Chưa liên kết nhưng bị lỗi
    } else {
      return "unknown"; // Các trường hợp khác
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

  // Phương thức để trigger manual khi phát hiện lỗi liên kết
  async triggerZaloLinkError(userId: number, errorType: string = 'unknown', updatedBy: string = 'system') {
    try {
      const user = await this.userService.findOneWithDetails(userId);
      
      if (!user) {
        this.logger.error(`Không tìm thấy user với ID: ${userId}`);
        return false;
      }

      // Cập nhật trạng thái user (sẽ tự động trigger notifyUserStatusChange)
      await this.userService.updateUser(userId, {
        zaloLinkStatus: 2
      }, undefined);

      this.logger.log(`Đã trigger lỗi liên kết cho user ${userId}`);
      return true;

    } catch (error) {
      this.logger.error(`Lỗi khi trigger lỗi liên kết cho user ${userId}: ${error.message}`);
      return false;
    }
  }
}

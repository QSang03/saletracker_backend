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
  private readonly processedUsers = new Map<number, number>(); // userId -> timestamp

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
    } else if (event.newStatus === 0) {
      // Với yêu cầu mới: nếu username là số điện thoại thì cũng gửi thông báo (status 0 = chưa liên kết)
      try {
        const user = await this.userService.findOneWithDetails(event.userId);
        if (!user) return;

        // Bỏ qua nếu user bị block
        if (user.isBlock === true) {
          this.logger.log(`⏭️ Bỏ qua user ${user.id} (${user.username}) - đã bị ban (is_block = true)`);
          return;
        }

        const username = (user.username || '').toString();
        if (this.isPhoneNumber(username)) {
          this.logger.log(`User ${event.userId} có username là số điện thoại, gửi notification cho trạng thái chưa liên kết...`);

          // Gửi thông báo chung đến admin dashboard (khác event để dễ phân biệt)
          this.userGateway.server
            .to('admin_dashboard')
            .emit('user_zalo_not_linked', {
              userId: event.userId,
              status: event.newStatus,
              updatedBy: event.updatedBy,
              timestamp: event.timestamp,
            });

          // Gọi API Python để xử lý (truyền user đã lấy để tránh fetch lại)
          await this.callPythonApiForLinkError(event, user);
        }
      } catch (e) {
        this.logger.error(`Failed handling newStatus=0 for user ${event.userId}: ${e?.message}`);
      }
    }
  }

  // Gọi API Python để xử lý lỗi liên kết Zalo
  // Gọi API Python để xử lý lỗi liên kết Zalo
  // Nếu `providedUser` được truyền vào, sẽ dùng object đó thay vì fetch lại từ DB (tiết kiệm 1 query)
  async callPythonApiForLinkError(event: UserStatusChangeEvent, providedUser?: any) {
    let payload: any;
    
    try {
      // ENFORCE: never send notifications before 08:00 VN timezone
      try {
        const now = new Date();
        const vnTimeString = now.toLocaleString('en-US', { 
          timeZone: 'Asia/Ho_Chi_Minh',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        const timePart = vnTimeString.split(', ')[1]; // "HH:MM:SS"
        const hour = parseInt(timePart.split(':')[0], 10);
        if (!isNaN(hour) && hour < 8) {
          this.logger.log(`⏰ Bỏ qua gửi notification đến Python API cho user ${event.userId} — ngoài giờ (trước 08:00 VN). Giờ VN hiện tại: ${timePart.substring(0,5)}`);
          return;
        }
      } catch (tzErr) {
        // If timezone parsing fails, conservative approach: allow send (or you may choose to skip)
        this.logger.warn(`⚠️ Không thể xác định giờ VN trước khi gửi (để an toàn có thể cân nhắc bỏ qua): ${tzErr?.message || tzErr}`);
      }
      // Kiểm tra user đã được xử lý gần đây chưa (trong vòng 5 phút)
      const now = Date.now();
      const lastProcessed = this.processedUsers.get(event.userId);
      if (lastProcessed && (now - lastProcessed) < 300000) { // 5 phút = 300000ms
        this.logger.log(`⏭️ Bỏ qua user ${event.userId} - đã được xử lý cách đây ${Math.round((now - lastProcessed) / 1000)}s`);
        return;
      }
      
      // Đánh dấu user đang được xử lý
      this.processedUsers.set(event.userId, now);
      // Lấy thông tin chi tiết của user (nếu chưa có)
      const user = providedUser ?? await this.userService.findOneWithDetails(event.userId);
      
      if (!user) {
        this.logger.error(`Không tìm thấy user với ID: ${event.userId}`);
        return;
      }

      // Kiểm tra user có bị ban không
      if (user.isBlock === true) {
        this.logger.log(`⏭️ Bỏ qua user ${user.id} (${user.username}) - đã bị ban (is_block = true)`);
        return;
      }

      // Kiểm tra user có phải là thietpn không
      if (user.username === 'thietpn' || user.email === 'thietpn@nguyenkimvn.vn') {
        this.logger.log(`⏭️ Bỏ qua user ${user.id} (${user.username}) - tài khoản thietpn không được phép gửi`);
        return;
      }

      // Kiểm tra user có email không
      if (!user.email || user.email.trim() === '') {
        this.logger.log(`⏭️ Bỏ qua user ${user.id} (${user.username}) - không có email`);
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
      this.logger.log(`✅ Gửi API thành công cho user ${user.id} (${user.username})`);

    } catch (error: any) {
      this.logger.error(`❌ Lỗi khi gọi Python API cho user ${event.userId}: ${error.message}`);
      this.logger.error(`Error details: ${JSON.stringify(error)}`);
      
      // Không throw error để không làm gián đoạn flow chính
    }
  }

  // Kiểm tra username có phải là số điện thoại không (đơn giản: chỉ gồm chữ số, 9-12 ký tự)
  private isPhoneNumber(s: string): boolean {
    return /^\d{9,12}$/.test(s);
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

      // Gọi trực tiếp API Python thay vì update user (để tránh duplicate event)
      await this.callPythonApiForLinkError({
        userId: user.id,
        oldStatus: user.zaloLinkStatus,
        newStatus: 2,
        updatedBy: updatedBy,
        timestamp: new Date(),
      });

      this.logger.log(`Đã trigger lỗi liên kết cho user ${userId}`);
      return true;

    } catch (error) {
      this.logger.error(`Lỗi khi trigger lỗi liên kết cho user ${userId}: ${error.message}`);
      return false;
    }
  }
}

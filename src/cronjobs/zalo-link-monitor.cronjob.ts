import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { UserStatusObserver } from '../observers/user-status.observer';

@Injectable()
export class ZaloLinkMonitorCronjob {
  private readonly logger = new Logger(ZaloLinkMonitorCronjob.name);
  private isRunning = false; // Lock để tránh duplicate execution

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @Inject(forwardRef(() => UserStatusObserver))
    private readonly userStatusObserver: UserStatusObserver,
  ) {
    this.logger.log('🚀 ZaloLinkMonitorCronjob khởi động');
  }

 
  @Cron(process.env.ZALO_LINK_MONITOR_CRON || '*/5 * * * *')
  async monitorZaloLinkStatus() {
    // Kiểm tra lock để tránh duplicate execution
    if (this.isRunning) {
      this.logger.warn(`⚠️ Cronjob đang chạy, bỏ qua lần này để tránh duplicate`);
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
        // Lấy tất cả user có zalo_link_status = 2 (lỗi liên kết)
      const usersWithError = await this.userRepo.find({
        where: { zaloLinkStatus: 2 },
        select: ['id', 'username', 'fullName', 'email', 'employeeCode', 'zaloLinkStatus', 'updatedAt']
      });

      for (const user of usersWithError) {
        // Gọi API Python để xử lý lỗi liên kết
        await this.handleZaloLinkError(user);
      }

    } catch (error) {
      this.logger.error(`Lỗi khi monitor Zalo link status: ${error.message}`);
    } finally {
      // Luôn reset lock trong finally block
      this.isRunning = false;
    }
  }

  private async handleZaloLinkError(user: User) {
    try {
      // Trigger notifyUserStatusChange để handleUserStatusChange xử lý
      await this.userStatusObserver.notifyUserStatusChange(
        user.id,
        user.zaloLinkStatus, // Trạng thái hiện tại
        2, // Lỗi liên kết
        'database_monitor'
      );
    } catch (error) {
      this.logger.error(`Lỗi khi xử lý lỗi liên kết cho user ${user.id}: ${error.message}`);
    }
  }

  // Reset lock nếu bị stuck
  resetLock() {
    this.isRunning = false;
  }
}

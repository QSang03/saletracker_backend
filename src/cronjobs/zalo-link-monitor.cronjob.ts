import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { UserStatusObserver } from '../observers/user-status.observer';
import { SystemConfig } from '../system_config/system_config.entity';

@Injectable()
export class ZaloLinkMonitorCronjob {
  private readonly logger = new Logger(ZaloLinkMonitorCronjob.name);
  private isRunning = false; // Lock để tránh duplicate execution

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(SystemConfig)
    private readonly systemConfigRepo: Repository<SystemConfig>,
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

    // Kiểm tra thời gian nghỉ
    const isInRestTime = await this.checkRestTime();
    if (isInRestTime) {
      this.logger.log(`😴 Bỏ qua cronjob - đang trong thời gian nghỉ`);
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    
    try {
        // Lấy tất cả user có zalo_link_status = 2 (lỗi liên kết) và không bị ban (is_block = false)
      const allUsersWithError = await this.userRepo.find({
        where: { 
          zaloLinkStatus: 2,
          isBlock: false // Chỉ lấy user không bị ban
        },
        select: ['id', 'username', 'fullName', 'email', 'employeeCode', 'zaloLinkStatus', 'isBlock', 'updatedAt']
      });

      // Lọc bỏ user thietpn và user không có email
      const usersWithError = allUsersWithError.filter(user => 
        user.username !== 'thietpn' && 
        user.email !== 'thietpn@nguyenkimvn.vn' &&
        user.email && user.email.trim() !== ''
      );

      this.logger.log(`📊 Tìm thấy ${allUsersWithError.length} users có lỗi liên kết, sau khi lọc thietpn và không có email còn ${usersWithError.length} users`);

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

  // Kiểm tra thời gian nghỉ
  private async checkRestTime(): Promise<boolean> {
    try {
      const config = await this.systemConfigRepo.findOne({
        where: { name: 'system_stopToolConfig' }
      });

      if (!config || !config.value) {
        this.logger.log('Không tìm thấy config system_stopToolConfig, cho phép chạy');
        return false;
      }

      const schedule = JSON.parse(config.value);
      const now = new Date();
      const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
      const currentTime = now.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit' 
      });

      // Kiểm tra ngày hiện tại có trong schedule không
      if (!schedule[currentDay]) {
        this.logger.log(`Ngày ${currentDay} không có trong schedule, cho phép chạy`);
        return false;
      }

      // Kiểm tra thời gian hiện tại có nằm trong khoảng nghỉ không
      const daySchedule = schedule[currentDay];
      for (const timeSlot of daySchedule) {
        if (this.isTimeInRange(currentTime, timeSlot.start, timeSlot.end)) {
          this.logger.log(`Thời gian hiện tại ${currentTime} nằm trong khoảng nghỉ ${timeSlot.start}-${timeSlot.end}`);
          return true;
        }
      }

      this.logger.log(`Thời gian hiện tại ${currentTime} không nằm trong khoảng nghỉ, cho phép chạy`);
      return false;

    } catch (error) {
      this.logger.error(`Lỗi khi kiểm tra thời gian nghỉ: ${error.message}`);
      return false; // Nếu có lỗi, cho phép chạy
    }
  }

  // Kiểm tra thời gian có nằm trong khoảng không
  private isTimeInRange(currentTime: string, startTime: string, endTime: string): boolean {
    const current = this.timeToMinutes(currentTime);
    const start = this.timeToMinutes(startTime);
    const end = this.timeToMinutes(endTime);

    if (start <= end) {
      // Khoảng thời gian trong cùng 1 ngày (ví dụ: 12:00-13:30)
      return current >= start && current <= end;
    } else {
      // Khoảng thời gian qua ngày (ví dụ: 23:00-07:00)
      return current >= start || current <= end;
    }
  }

  // Chuyển đổi thời gian thành phút để so sánh
  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
}

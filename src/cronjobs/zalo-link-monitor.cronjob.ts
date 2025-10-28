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
  private lastRunTime = 0; // Thời gian chạy cuối cùng
  private processedUsers = new Set<number>(); // Set để track user đã xử lý trong phiên này

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
    const currentTime = Date.now();
    
    // Kiểm tra lock để tránh duplicate execution
    if (this.isRunning) {
      this.logger.warn(`⚠️ Cronjob đang chạy, bỏ qua lần này để tránh duplicate`);
      return;
    }
    
    // Kiểm tra thời gian chạy cuối cùng (tránh chạy quá gần nhau)
    if (currentTime - this.lastRunTime < 60000) { // 60 giây
      this.logger.warn(`⚠️ Cronjob vừa chạy cách đây ${Math.round((currentTime - this.lastRunTime) / 1000)}s, bỏ qua để tránh duplicate`);
      return;
    }

    // Kiểm tra thời gian nghỉ
    const isInRestTime = await this.checkRestTime();
    if (isInRestTime) {
      this.logger.log(`😴 Bỏ qua cronjob - đang trong thời gian nghỉ`);
      return;
    }

    this.isRunning = true;
    this.lastRunTime = currentTime;
    const startTime = Date.now();
    
    try {
        // Lấy tất cả user có zalo_link_status = 2 (lỗi liên kết) hoặc zalo_link_status = 0
        // (chúng ta sẽ chỉ xử lý status 0 khi username trông như số điện thoại), và không bị ban
        const allCandidates = await this.userRepo.find({
          where: [
            { zaloLinkStatus: 2, isBlock: false },
            { zaloLinkStatus: 0, isBlock: false },
          ],
          select: ['id', 'username', 'fullName', 'email', 'employeeCode', 'zaloLinkStatus', 'isBlock', 'updatedAt']
        });

        // Lọc bỏ user thietpn và user không có email
        const usersToProcess = allCandidates.filter(user => {
          if (!user) return false;
          if (user.username === 'thietpn' || user.email === 'thietpn@nguyenkimvn.vn') return false;
          if (!user.email || user.email.trim() === '') return false;

          // Nếu status = 2 => xử lý luôn
          if (user.zaloLinkStatus === 2) return true;

          // Nếu status = 0 => chỉ xử lý nếu username là số điện thoại (9-12 chữ số)
          if (user.zaloLinkStatus === 0) {
            const uname = (user.username || '').toString();
            return /^\d{9,12}$/.test(uname);
          }

          return false;
        });

        this.logger.log(`📊 Tìm thấy ${allCandidates.length} candidate users (status 2 hoặc 0), sau khi lọc thietpn và không có email còn ${usersToProcess.length} users`);

        for (const user of usersToProcess) {
        // Kiểm tra user đã được xử lý trong phiên này chưa
        if (this.processedUsers.has(user.id)) {
          this.logger.log(`⏭️ Bỏ qua user ${user.id} (${user.username}) - đã được xử lý trong phiên này`);
          continue;
        }
        
          // Gọi API Python để xử lý lỗi liên kết hoặc chưa liên kết (tùy status)
          await this.handleZaloLinkError(user);
        
        // Đánh dấu user đã được xử lý
        this.processedUsers.add(user.id);
      }

    } catch (error) {
      this.logger.error(`Lỗi khi monitor Zalo link status: ${error.message}`);
    } finally {
      // Luôn reset lock trong finally block
      this.isRunning = false;
      
      // Clear processed users sau mỗi lần chạy
      this.processedUsers.clear();
    }
  }

  private async handleZaloLinkError(user: User) {
    try {
      // Gọi trực tiếp API Python thay vì trigger event (để tránh duplicate)
      const newStatus = user.zaloLinkStatus === 0 ? 0 : 2;
      await this.userStatusObserver.callPythonApiForLinkError({
        userId: user.id,
        oldStatus: user.zaloLinkStatus,
        newStatus,
        updatedBy: 'database_monitor',
        timestamp: new Date(),
      }, user);
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

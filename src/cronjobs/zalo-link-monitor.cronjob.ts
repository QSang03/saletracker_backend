import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs';
import * as path from 'path';
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
    // write startup to daily file
    this.appendFileLog('INFO', 'ZaloLinkMonitorCronjob khởi động').catch(
      () => {},
    );
  }

  @Cron(process.env.ZALO_LINK_MONITOR_CRON || '*/5 * * * *')
  async monitorZaloLinkStatus() {
    const currentTime = Date.now();
    // Log invocation immediately so we can detect whether cron is firing
    this.logger.log('🔔 monitorZaloLinkStatus invoked');
    this.appendFileLog('INFO', 'monitorZaloLinkStatus invoked').catch(() => {});

    // ENFORCE: never run sending before 08:00 local server time for any reason
    try {
      // Use Intl.DateTimeFormat to reliably compute VN hour/minute
      const now = new Date();
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const parts = timeFormatter.formatToParts(now);
      const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '00';
      const minutePart = parts.find((p) => p.type === 'minute')?.value ?? '00';
      const secondPart = parts.find((p) => p.type === 'second')?.value ?? '00';
      const timePart = `${hourPart.padStart(2, '0')}:${minutePart.padStart(2, '0')}:${secondPart.padStart(2, '0')}`;
      const hour = parseInt(hourPart, 10);

      this.logger.log(`🔎 VN time (monitor check): ${timePart} (hour=${hour})`);

      if (isNaN(hour) || hour < 8) {
        const msg = `⏰ Bỏ qua cronjob - chỉ được phép gửi sau 08:00 (VN timezone). Giờ hiện tại: ${timePart.substring(0, 5)} (${isNaN(hour) ? 'NaN' : hour + 'h'})`;
        this.logger.log(msg);
        this.appendFileLog('INFO', msg).catch(() => {});
        return;
      }
    } catch (err) {
      // If anything odd happens reading time, be conservative and skip sending
      const warn = `⚠️ Không thể xác định thời gian hiện tại (VN timezone), bỏ qua cronjob để an toàn: ${err?.message || err}`;
      this.logger.warn(warn);
      this.appendFileLog('WARN', warn).catch(() => {});
      return;
    }

    // Kiểm tra lock để tránh duplicate execution
    if (this.isRunning) {
      const msg = `⚠️ Cronjob đang chạy, bỏ qua lần này để tránh duplicate`;
      this.logger.warn(msg);
      this.appendFileLog('WARN', msg).catch(() => {});
      return;
    }

    // Kiểm tra thời gian chạy cuối cùng (tránh chạy quá gần nhau)
    if (currentTime - this.lastRunTime < 60000) {
      // 60 giây
      const msg = `⚠️ Cronjob vừa chạy cách đây ${Math.round((currentTime - this.lastRunTime) / 1000)}s, bỏ qua để tránh duplicate`;
      this.logger.warn(msg);
      this.appendFileLog('WARN', msg).catch(() => {});
      return;
    }

    // Kiểm tra thời gian nghỉ (fixed window 08:00 - 17:45)
    const isInRestTime = await this.checkRestTime();
    if (isInRestTime) {
      const msg = `😴 Bỏ qua cronjob - hiện tại ngoài khung giờ gửi hoặc là ngày nghỉ (08:00-17:45 + DB ngày nghỉ)`;
      this.logger.log(msg);
      this.appendFileLog('INFO', msg).catch(() => {});
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
        select: [
          'id',
          'username',
          'fullName',
          'email',
          'employeeCode',
          'zaloLinkStatus',
          'isBlock',
          'updatedAt',
        ],
      });

      // Lọc bỏ user thietpn và user không có email
      const usersToProcess = allCandidates.filter((user) => {
        if (!user) return false;
        if (
          user.username === 'thietpn' ||
          user.email === 'thietpn@nguyenkimvn.vn'
        )
          return false;
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

      const foundMsg = `📊 Tìm thấy ${allCandidates.length} candidate users (status 2 hoặc 0), sau khi lọc thietpn và không có email còn ${usersToProcess.length} users`;
      this.logger.log(foundMsg);
      this.appendFileLog('INFO', foundMsg).catch(() => {});

      for (const user of usersToProcess) {
        // Kiểm tra user đã được xử lý trong phiên này chưa
        if (this.processedUsers.has(user.id)) {
          const skipMsg = `⏭️ Bỏ qua user ${user.id} (${user.username}) - đã được xử lý trong phiên này`;
          this.logger.log(skipMsg);
          this.appendFileLog('INFO', skipMsg).catch(() => {});
          continue;
        }

        // Gọi API Python để xử lý lỗi liên kết hoặc chưa liên kết (tùy status)
        await this.handleZaloLinkError(user);

        // Đánh dấu user đã được xử lý
        this.processedUsers.add(user.id);
      }
    } catch (error) {
      const errMsg = `Lỗi khi monitor Zalo link status: ${error.message}`;
      this.logger.error(errMsg);
      this.appendFileLog('ERROR', errMsg + ' - ' + JSON.stringify(error)).catch(
        () => {},
      );
    } finally {
      // Luôn reset lock trong finally block
      this.isRunning = false;

      // Clear processed users sau mỗi lần chạy
      this.processedUsers.clear();
      const duration = Date.now() - startTime;
      const finishMsg = `Kết thúc cronjob, thời gian chạy ${duration}ms`;
      this.logger.log(finishMsg);
      this.appendFileLog('INFO', finishMsg).catch(() => {});
    }
  }

  // Append log line to a per-day file under Backend/logs
  private async appendFileLog(level: string, message: string) {
    try {
      const vnDate = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      }); // YYYY-MM-DD
      const logsDir = path.resolve(process.cwd(), 'Backend', 'logs');
      await fs.promises.mkdir(logsDir, { recursive: true });
      const fileName = `zalo-link-monitor-${vnDate}.log`;
      const fullPath = path.join(logsDir, fileName);
      const line = `${new Date().toISOString()} [${level}] ${message}\n`;
      await fs.promises.appendFile(fullPath, line, { encoding: 'utf8' });
    } catch (e) {
      // swallow to avoid affecting cronjob
    }
  }

  private async handleZaloLinkError(user: User) {
    try {
      // Gọi trực tiếp API Python thay vì trigger event (để tránh duplicate)
      const newStatus = user.zaloLinkStatus === 0 ? 0 : 2;
      await this.userStatusObserver.callPythonApiForLinkError(
        {
          userId: user.id,
          oldStatus: user.zaloLinkStatus,
          newStatus,
          updatedBy: 'database_monitor',
          timestamp: new Date(),
        },
        user,
      );
    } catch (error) {
      this.logger.error(
        `Lỗi khi xử lý lỗi liên kết cho user ${user.id}: ${error.message}`,
      );
    }
  }

  // Reset lock nếu bị stuck
  resetLock() {
    this.isRunning = false;
  }

  // Kiểm tra thời gian nghỉ
  private async checkRestTime(): Promise<boolean> {
    try {
      // Fixed allowed window: 08:00 - 17:45 local server time
      // Use VN timezone everywhere for consistent checks
      const now = new Date();

      // Use Intl.DateTimeFormat.formatToParts to reliably get hour/minute in VN timezone
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      const parts = timeFormatter.formatToParts(now);
      const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '00';
      const minutePart = parts.find((p) => p.type === 'minute')?.value ?? '00';
      const currentTime = `${hourPart.padStart(2, '0')}:${minutePart.padStart(2, '0')}`; // "HH:MM"

      const allowedStart = '08:00';
      const allowedEnd = '17:45';

      // isTimeInRange returns true when current is within start-end (handles wrap)
      const isWithinAllowed = this.isTimeInRange(
        currentTime,
        allowedStart,
        allowedEnd,
      );
      if (!isWithinAllowed) {
        this.logger.log(
          `Thời gian hiện tại ${currentTime} nằm ngoài khung ${allowedStart}-${allowedEnd}`,
        );
        return true; // In rest time (outside allowed window)
      }

      // Additional DB-based checks: skip Sundays and configured holidays
      // Get VN weekday reliably
      const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Ho_Chi_Minh',
        weekday: 'short',
      });
      const vnWeekday = weekdayFormatter.format(now); // e.g. 'Sun', 'Mon'
      const vnDayOfWeek = [
        'Sun',
        'Mon',
        'Tue',
        'Wed',
        'Thu',
        'Fri',
        'Sat',
      ].indexOf(vnWeekday);

      this.logger.log(
        `🔎 VN time computed: ${currentTime}, weekday: ${vnWeekday} (index ${vnDayOfWeek})`,
      );

      // 1) If Sunday, check system_scheduleSunday
      if (vnDayOfWeek === 0) {
        const allowSunday = await this.isSundayRunAllowed();
        if (!allowSunday) {
          this.logger.log(
            '🚫 Hôm nay là Chủ nhật và cấu hình DB không cho phép chạy',
          );
          return true;
        }
      }

      // 2) Check holiday configs
      const allowHolidayRun = await this.isHolidayRunAllowed();
      if (!allowHolidayRun) {
        this.logger.log(
          '🚫 Cấu hình system_scheduleHoliday = 0 → chặn toàn bộ ngày lễ',
        );
        return true;
      }

      const isHoliday = await this.isTodayHoliday();
      if (isHoliday) {
        this.logger.log(
          '🚫 Hôm nay là ngày nghỉ theo cấu hình DB (holiday_*) → bỏ qua',
        );
        return true;
      }

      this.logger.log(
        `Thời gian hiện tại ${currentTime} nằm trong khung ${allowedStart}-${allowedEnd} và không phải ngày nghỉ, cho phép chạy`,
      );
      return false;
    } catch (error) {
      this.logger.error(
        `Lỗi khi kiểm tra thời gian nghỉ: ${error?.message || error}`,
      );
      return false; // Fail-safe: allow run on error
    }
  }

  private async isSundayRunAllowed(): Promise<boolean> {
    try {
      const config = await this.systemConfigRepo.findOne({
        where: { name: 'system_scheduleSunday' },
      });
      const result = config?.value === '1';
      this.logger.log(
        `📋 system_scheduleSunday: ${config?.value || 'null'} → ${result ? 'Cho phép' : 'Không cho phép'}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        '❌ Lỗi kiểm tra system_scheduleSunday:',
        error?.message || error,
      );
      return false; // Fail-safe
    }
  }

  private async isHolidayRunAllowed(): Promise<boolean> {
    try {
      const config = await this.systemConfigRepo.findOne({
        where: { name: 'system_scheduleHoliday' },
      });
      const result = config?.value === '1';
      this.logger.log(
        `📋 system_scheduleHoliday: ${config?.value || 'null'} → ${result ? 'Cho phép kiểm tra chi tiết' : 'Chặn hoàn toàn'}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        '❌ Lỗi kiểm tra system_scheduleHoliday:',
        error?.message || error,
      );
      return false;
    }
  }

  private async isTodayHoliday(): Promise<boolean> {
    try {
      const today = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      }); // YYYY-MM-DD
      this.logger.log(`📅 Kiểm tra ngày nghỉ cho: ${today} (VN timezone)`);

      const holidayConfigs = await this.systemConfigRepo.find({
        where: [
          { name: 'holiday_multi_days' },
          { name: 'holiday_single_day' },
          { name: 'holiday_separated_days' },
        ],
      });

      for (const config of holidayConfigs) {
        if (!config.value) continue;
        try {
          const holidays = JSON.parse(config.value);
          for (const holiday of holidays) {
            if (holiday.dates?.includes(today)) {
              this.logger.log(
                `🏖️ Tìm thấy ngày nghỉ: ${today} - ${holiday.reason || 'no reason'}`,
              );
              return true;
            }
          }
        } catch (parseError) {
          this.logger.error(
            `❌ Lỗi parse JSON cho ${config.name}:`,
            parseError?.message || parseError,
          );
        }
      }

      return false;
    } catch (error) {
      this.logger.error('❌ Lỗi kiểm tra ngày nghỉ:', error?.message || error);
      return true; // Fail-safe: consider holiday on error to avoid accidental sends
    }
  }

  // Kiểm tra thời gian có nằm trong khoảng không
  private isTimeInRange(
    currentTime: string,
    startTime: string,
    endTime: string,
  ): boolean {
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

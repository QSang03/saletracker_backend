import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import {
  ExtendReason,
  OrderDetail,
} from '../order-details/order-detail.entity';
import { SystemConfig } from '../system_config/system_config.entity';
import { WinstonLogger } from '../common/winston.logger';

@Injectable()
export class OrderCleanupCronjobService {
  private readonly logger = new WinstonLogger(OrderCleanupCronjobService.name);
  // Dedicated history log for run summaries
  private readonly historyLogger = new WinstonLogger(
    `${OrderCleanupCronjobService.name}.history`,
  );

  constructor(
    @InjectRepository(OrderDetail)
    private orderDetailRepository: Repository<OrderDetail>,
    @InjectRepository(SystemConfig)
    private systemConfigRepository: Repository<SystemConfig>,
  ) {}

  // ✅ SỬA: Chạy MỌI NGÀY để có thể check và xử lý (0 = Chủ nhật, 1-6 = Thứ 2-7)
  @Cron(process.env.CRON_ORDER_CLEANUP_TIME || '00 01 * * *')
  async cleanupExpiredOrderDetails() {
    const executionStartTime = new Date();
    let historyExtendResult: {
      affected: number | null;
      daysExtended: number;
    } | null = null;
    let historyHiddenCount = 0;
    try {
      // Skip processing during lunch window VN timezone: 12:00 - 13:30
      const nowVNForSkip = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }),
      );
      const hSkip = nowVNForSkip.getHours();
      const mSkip = nowVNForSkip.getMinutes();
      const inLunchWindow = hSkip === 12 || (hSkip === 13 && mSkip < 30);
      if (inLunchWindow) {
        this.logger.log(
          '⏸️ Cronjob skipped do khung giờ nghỉ trưa (12:00-13:30 VN)',
        );
        this.historyLogger.info('Run skipped (lunch window)', {
          now: this.formatDateTime(nowVNForSkip),
        });
        return;
      }

      this.logger.log('=== Bắt đầu cronjob kiểm tra order details ===');
      this.logger.log(
        `🕐 Thời gian thực hiện: ${this.formatDateTime(executionStartTime)}`,
      );
      this.logger.log(
        `📅 Ngày hiện tại: ${this.formatDate(executionStartTime)}`,
      );

      // Log run to history
      this.historyLogger.info('Run started', {
        executionStartTime: this.formatDateTime(executionStartTime),
      });

      // Kiểm tra điều kiện chạy
      const canRun = await this.canRunToday();

      if (!canRun) {
        // KHÔNG được phép chạy cleanup → Gia hạn extended
        this.logger.log(
          '❌ Không được phép chạy cleanup hôm nay → Gia hạn extended',
        );
        const extendResult = await this.extendAllActiveOrderDetails();
        historyExtendResult = extendResult || null;
        this.historyLogger.info('Extend performed', {
          daysExtended: extendResult?.daysExtended,
          affected: extendResult?.affected,
        });
        this.logger.log('✅ Đã hoàn thành gia hạn extended thay thế');
      } else {
        // ĐƯỢC phép chạy cleanup → Xử lý bình thường
        this.logger.log('✅ Được phép chạy cleanup hôm nay');

        const orderDetails = await this.getActiveOrderDetails();
        this.logger.log(
          `📦 Tìm thấy ${orderDetails.length} order details cần kiểm tra`,
        );

        const expiredIds = this.calculateExpiredOrderDetails(orderDetails);

        if (expiredIds.length > 0) {
          const hiddenCount = await this.softHideOrderDetails(expiredIds);
          historyHiddenCount = hiddenCount;
          this.historyLogger.info('Hidden records', {
            hiddenCount,
            expiredCount: expiredIds.length,
          });
          this.logger.log(`✅ Đã ẩn ${expiredIds.length} order details`);
        } else {
          this.logger.log('✅ Không có order detail nào cần ẩn');
        }
      }

      const executionEndTime = new Date();
      const executionTime =
        executionEndTime.getTime() - executionStartTime.getTime();
      this.logger.log(`⏱️ Thời gian thực hiện: ${executionTime}ms`);
      this.historyLogger.info('Run finished', {
        executionStartTime: this.formatDateTime(executionStartTime),
        executionEndTime: this.formatDateTime(executionEndTime),
        executionTimeMs: executionTime,
        extendResult: historyExtendResult,
        hiddenCount: historyHiddenCount,
      });
      this.logger.log('=== Kết thúc cronjob ===');
    } catch (error) {
      this.logger.error(
        '❌ Lỗi trong quá trình thực hiện cronjob:',
        error.stack,
      );
      this.historyLogger.error('Run failed', error.stack, {
        error: error.message,
        executionStartTime: this.formatDateTime(executionStartTime),
      });
      throw error;
    }
  }

  /**
   * Kiểm tra 1 ngày cụ thể (YYYY-MM-DD, VN timezone) có nằm trong holiday configs
   */
  private async isGivenDateHoliday(ymd: string): Promise<boolean> {
    try {
      const holidayConfigs = await this.systemConfigRepository.find({
        where: [
          { name: 'holiday_multi_days' },
          { name: 'holiday_single_day' },
          { name: 'holiday_separated_days' },
        ],
      });

      for (const config of holidayConfigs) {
        if (!config?.value) continue;
        try {
          const holidays = JSON.parse(config.value);
          for (const holiday of holidays) {
            if (holiday.dates?.includes(ymd)) {
              return true;
            }
          }
        } catch (e) {
          this.logger.error(`❌ Lỗi parse JSON cho ${config.name}:`, e.message);
        }
      }
      return false;
    } catch (error) {
      this.logger.error('❌ Lỗi khi kiểm tra ngày nghỉ cụ thể:', error.message);
      // On error, do NOT automatically treat date as holiday to avoid
      // accidental mass-extensions when DB/config is temporarily unreadable.
      return false;
    }
  }

  /**
   * ✅ THÊM MỚI: Gia hạn extended cho tất cả order details khi không chạy được
   * Logic: Khi cronjob không chạy (ngày nghỉ/chủ nhật) thì gia hạn thêm 1 ngày
   */
  private async extendAllActiveOrderDetails(): Promise<{
    affected: number | null;
    daysExtended: number;
  }> {
    try {
      this.logger.log('🆙 === BẮT ĐẦU GIA HẠN EXTENDED CHO TẤT CẢ ĐƠN ===');

      // Lấy danh sách order details active
      const orderDetails = await this.getActiveOrderDetails();

      if (orderDetails.length === 0) {
        this.logger.log('📦 Không có order detail nào để gia hạn');
        return { affected: 0, daysExtended: 0 };
      }

      this.logger.log(
        `📦 Tìm thấy ${orderDetails.length} order details cần gia hạn`,
      );

      // Log chi tiết trước khi update
      for (const orderDetail of orderDetails) {
        const currentExtended = orderDetail.extended || 4;
        const newExtended = currentExtended + 1;
        this.logger.log(
          `📋 Order Detail ID ${orderDetail.id}: ${currentExtended} → ${newExtended} ngày`,
        );
      }

      // Guard: avoid double extending in the same VN day (or multiple runs)
      const nowVN = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }),
      );
      const todayVNStr = nowVN.toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      }); // YYYY-MM-DD

      const CONFIG_NAME = 'order_cleanup_last_extended_day';
      // We'll compute how many blocked days have passed since last extension
      // and apply that many increments in one go (so if holiday was 2 days, add 2)
      // We'll fetch and lock the system_config row within a transaction to avoid races
      let updateResult: any;
      let calcDaysToExtendOut = 0;
      // Chủ nhật luôn được xem là ngày nghỉ để gia hạn (+1)
      // (không phụ thuộc cấu hình system_scheduleSunday)
      // remove unused call to isHolidayRunAllowed() here (it was a noop)
      await this.orderDetailRepository.manager.transaction(async (manager) => {
        // SELECT ... FOR UPDATE on system_config row
        const rows = await manager.query(
          'SELECT * FROM system_config WHERE name = ? FOR UPDATE',
          [CONFIG_NAME],
        );
        const row = rows[0] || null;
        const lastConfigValue = row?.value || null;

        let lastDate = null as Date | null;
        if (lastConfigValue) {
          try {
            lastDate = new Date(lastConfigValue + 'T00:00:00+07:00');
          } catch (err) {
            lastDate = null;
          }
        }

        const todayDate = new Date(todayVNStr + 'T00:00:00+07:00');
        const startDate = lastDate
          ? new Date(lastDate.getTime() + 24 * 60 * 60 * 1000)
          : todayDate;
        let iter = new Date(startDate);
        let calcDaysToExtend = 0;
        let calcHasHoliday = false;
        // collect holiday dates found in the iteration window so we can
        // limit which orders are eligible for extension
        const holidayDatesFound: string[] = [];
        while (iter.getTime() <= todayDate.getTime()) {
          // Lấy ngày theo VN timezone để tránh lệch ngày do UTC/toISOString
          const ymd = new Date(
            new Date(iter).toLocaleString('en-US', {
              timeZone: 'Asia/Ho_Chi_Minh',
            }),
          ).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

          const dayDateVN = new Date(`${ymd}T12:00:00+07:00`);
          // Use local weekday (getDay) consistently to avoid UTC/local mismatch
          const dayOfWeek = dayDateVN.getDay(); // 0 = Chủ nhật
          const isHoliday = await this.isGivenDateHoliday(ymd);

          // ✅ Rule: CN luôn tính là ngày nghỉ (+1), holiday thì nghỉ mấy ngày + mấy
          if (dayOfWeek === 0 || isHoliday) {
            calcDaysToExtend += 1;
            if (isHoliday) {
              calcHasHoliday = true;
              // record this holiday date so we can limit which orders to extend
              holidayDatesFound.push(ymd);
            }
          }
          iter = new Date(iter.getTime() + 24 * 60 * 60 * 1000);
        }

        if (calcDaysToExtend <= 0) {
          // Nothing to do
          return { affected: 0, daysExtended: 0 };
        }

        // Update records that haven't been extended today
        const reason = calcHasHoliday
          ? ExtendReason.SYSTEM_HOLIDAY_AUTO
          : ExtendReason.SYSTEM_SUNDAY_AUTO;
        const qb = manager
          .createQueryBuilder()
          .update(OrderDetail)
          .set({
            extended: () => `COALESCE(extended, 4) + ${calcDaysToExtend}`,
            extend_reason: reason,
            last_extended_at: () => 'CURRENT_TIMESTAMP()',
          })
          .where('deleted_at IS NULL')
          .andWhere('hidden_at IS NULL')
          .andWhere(
            `(last_extended_at IS NULL OR DATE(CONVERT_TZ(last_extended_at, @@session.time_zone, 'Asia/Ho_Chi_Minh')) < :todayVN)`,
            { todayVN: todayVNStr },
          );

        // If we found holiday dates, restrict extension to orders that were
        // created on or before the earliest holiday date in the window. This
        // avoids extending orders created after the holiday was (later) added.
        if (holidayDatesFound.length > 0) {
          holidayDatesFound.sort();
          const earliestHoliday = holidayDatesFound[0]; // YYYY-MM-DD
          qb.andWhere(
            `DATE(CONVERT_TZ(created_at, @@session.time_zone, 'Asia/Ho_Chi_Minh')) <= :earliestHoliday`,
            { earliestHoliday },
          );
        }

        updateResult = await qb.execute();
        calcDaysToExtendOut = calcDaysToExtend;

        // Upsert system_config row: insert if not exists, or update if exists
        if (!row) {
          await manager.query(
            'INSERT INTO system_config (name, value, display_name, type, section, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
            [
              CONFIG_NAME,
              todayVNStr,
              'Last day cron extended order details',
              'string',
              'cronjobs',
              1,
            ],
          );
        } else {
          await manager.query(
            'UPDATE system_config SET value = ?, updated_at = NOW() WHERE name = ?',
            [todayVNStr, CONFIG_NAME],
          );
        }
      });

      // The update + config upsert are performed inside the transaction above.
      // Log results below if updateResult was set.
      if (updateResult?.affected) {
        this.logger.log(
          `✅ Đã gia hạn extended cho ${updateResult.affected} order details`,
        );
        this.logger.log(`📅 Ngày VN (khi cập nhật): ${todayVNStr}`);
        this.logger.log(
          `🕐 Thời gian gia hạn: ${this.formatDateTime(new Date())}`,
        );
        this.logger.log('🆙 === KẾT THÚC GIA HẠN EXTENDED ===');
      } else {
        this.logger.log(
          '⚠️ Không có bản ghi nào được gia hạn (có thể đã gia hạn trước đó trong ngày)',
        );
      }

      return {
        affected: updateResult?.affected || 0,
        daysExtended: calcDaysToExtendOut,
      };
    } catch (error) {
      this.logger.error('❌ Lỗi khi gia hạn extended:', error.stack);
      throw error;
    }
  }

  /**
   * Format datetime để hiển thị rõ ràng
   */
  private formatDateTime(date: Date): string {
    return date.toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  /**
   * Format date để hiển thị ngày tháng
   */
  private formatDate(date: Date): string {
    return date.toLocaleDateString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  /**
   * ✅ SỬA LẠI: Kiểm tra xem có được phép chạy cronjob hôm nay không
   * Logic đúng: Chủ nhật + Ngày nghỉ
   */
  private async canRunToday(): Promise<boolean> {
    try {
      // Use VN (Asia/Ho_Chi_Minh) timezone for the date & day-of-week calculations
      // This avoids mismatches when the server timezone is different (ex. UTC) and the
      // cron runs around midnight in VN time, which previously produced the wrong dayOfWeek.
      const nowVN = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }),
      );
      // Format: YYYY-MM-DD (en-CA), and get day-of-week from the VN-time date object
      const todayStr = nowVN.toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      const dayOfWeek = nowVN.getDay(); // 0 = Chủ nhật, 1 = Thứ 2, ..., 6 = Thứ 7

      this.logger.log(
        `🔍 Kiểm tra điều kiện chạy cho ngày (VN timezone): ${todayStr} (${this.formatDate(nowVN)})`,
      );
      this.logger.log(
        `📅 Thứ trong tuần (VN timezone): ${this.getDayOfWeekName(dayOfWeek)} (${dayOfWeek})`,
      );

      // 1. Chủ nhật: luôn chặn để gia hạn thay vì cleanup
      if (dayOfWeek === 0) {
        this.logger.log('🚫 Hôm nay là chủ nhật - luôn gia hạn, không cleanup');
        return false; // Force extend on Sundays
      }

      // 2. ✅ SỬA LẠI: Kiểm tra ngày nghỉ với logic đúng
      // Bước 1: Kiểm tra cấu hình tổng quan trước
      const allowHolidayRun = await this.isHolidayRunAllowed();
      this.logger.log(
        `⚙️ Cấu hình tổng quan cho phép chạy ngày nghỉ: ${allowHolidayRun ? 'Có' : 'Không'}`,
      );

      if (!allowHolidayRun) {
        // system_scheduleHoliday = '0' → CHẶN HOÀN TOÀN
        this.logger.log(
          '❌ Không thể chạy: system_scheduleHoliday = 0 (chặn hoàn toàn ngày nghỉ) - sẽ gia hạn thay thế',
        );
        return false;
      }

      // Bước 2: Nếu allowHolidayRun = true (system_scheduleHoliday = '1')
      // → Kiểm tra chi tiết xem hôm nay có trong danh sách lịch nghỉ không
      const isHoliday = await this.isTodayHoliday();
      this.logger.log(
        `🏖️ Hôm nay có phải ngày nghỉ cụ thể: ${isHoliday ? 'Có' : 'Không'}`,
      );

      if (isHoliday) {
        this.logger.log(
          '❌ Không thể chạy: Hôm nay có trong danh sách lịch nghỉ cụ thể - sẽ gia hạn thay thế',
        );
        return false;
      }

      this.logger.log('✅ Được phép chạy cronjob cleanup');
      return true;
    } catch (error) {
      this.logger.error(
        '❌ Lỗi khi kiểm tra điều kiện chạy cronjob - MẶC ĐỊNH CHẶN để an toàn:',
        error.stack,
      );
      // Fail-safe: Có lỗi thì không chạy để an toàn
      return false;
    }
  }

  /**
   * Lấy tên thứ trong tuần
   */
  private getDayOfWeekName(dayOfWeek: number): string {
    const days = [
      'Chủ nhật',
      'Thứ 2',
      'Thứ 3',
      'Thứ 4',
      'Thứ 5',
      'Thứ 6',
      'Thứ 7',
    ];
    return days[dayOfWeek];
  }

  /**
   * Kiểm tra cấu hình có cho phép chạy vào chủ nhật không
   */
  private async isSundayRunAllowed(): Promise<boolean> {
    try {
      const config = await this.systemConfigRepository.findOne({
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
        error.message,
      );
      return false; // Fail-safe
    }
  }

  /**
   * ✅ SỬA LẠI: Kiểm tra cấu hình có cho phép chạy vào ngày nghỉ không
   * Logic: 0 = Chặn hoàn toàn, 1 = Cho phép nhưng check thêm danh sách cụ thể
   */
  private async isHolidayRunAllowed(): Promise<boolean> {
    try {
      const config = await this.systemConfigRepository.findOne({
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
        error.message,
      );
      return false; // Fail-safe
    }
  }

  /**
   * ✅ SỬA LẠI: Kiểm tra hôm nay có phải ngày nghỉ không (timezone đồng nhất)
   */
  private async isTodayHoliday(): Promise<boolean> {
    try {
      // Sử dụng timezone VN đồng nhất
      const today = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      }); // Format: YYYY-MM-DD

      this.logger.log(`📅 Kiểm tra ngày nghỉ cho: ${today} (VN timezone)`);

      const holidayConfigs = await this.systemConfigRepository.find({
        where: [
          { name: 'holiday_multi_days' },
          { name: 'holiday_single_day' },
          { name: 'holiday_separated_days' },
        ],
      });

      this.logger.log(
        `📋 Tìm thấy ${holidayConfigs.length} cấu hình ngày nghỉ`,
      );

      for (const config of holidayConfigs) {
        if (!config.value) {
          this.logger.log(`⚠️ ${config.name}: Không có giá trị`);
          continue;
        }

        try {
          const holidays = JSON.parse(config.value);
          this.logger.log(
            `📋 ${config.name}: ${holidays.length} nhóm ngày nghỉ`,
          );

          for (const holiday of holidays) {
            if (holiday.dates?.includes(today)) {
              this.logger.log(
                `🏖️ Tìm thấy ngày nghỉ: ${today} - ${holiday.reason}`,
              );
              return true;
            }
          }
        } catch (parseError) {
          this.logger.error(
            `❌ Lỗi parse JSON cho ${config.name}:`,
            parseError.message,
          );
        }
      }

      this.logger.log(`✅ ${today} không phải ngày nghỉ cụ thể`);
      return false;
    } catch (error) {
      this.logger.error('❌ Lỗi kiểm tra ngày nghỉ:', error.message);
      return true; // Fail-safe: Có lỗi thì coi như ngày nghỉ để không chạy
    }
  }

  /**
   * Lấy danh sách order_detail chưa bị xóa mềm
   */
  private async getActiveOrderDetails(): Promise<OrderDetail[]> {
    const result = await this.orderDetailRepository.find({
      where: {
        deleted_at: IsNull(),
        hidden_at: IsNull(),
      },
      select: ['id', 'created_at', 'extended'],
      order: { created_at: 'ASC' }, // Sắp xếp theo thời gian tạo
    });

    this.logger.log(`📦 Query kết quả: ${result.length} order details active`);
    return result;
  }

  /**
   * ✅ SỬA LẠI: Tính toán extended chính xác theo số ngày thực tế
   * Công thức mới: Tính số ngày đã trôi qua kể từ khi tạo
   */
  private calculateExpiredOrderDetails(orderDetails: OrderDetail[]): number[] {
    // Use VN timezone to calculate days passed so that "created_at" and "today"
    // comparisons are consistent regardless of server timezone
    const currentDate = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }),
    );

    // Chuẩn hóa về đầu ngày để so sánh chính xác (00:00:00)
    const currentDateOnly = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      currentDate.getDate(),
    );

    this.logger.log(`🔢 === BẮT ĐẦU TÍNH TOÁN EXTENDED MỚI ===`);
    this.logger.log(`📅 Ngày hiện tại: ${this.formatDate(currentDate)}`);
    this.logger.log(
      `🔢 Timestamp hiện tại (đầu ngày): ${currentDateOnly.getTime()}`,
    );

    const expiredIds: number[] = [];

    for (const orderDetail of orderDetails) {
      try {
        // Normalize created_at to VN timezone as well for consistent day calculations
        const createdDate = new Date(
          new Date(orderDetail.created_at).toLocaleString('en-US', {
            timeZone: 'Asia/Ho_Chi_Minh',
          }),
        );

        // Chuẩn hóa created_at về đầu ngày
        const createdDateOnly = new Date(
          createdDate.getFullYear(),
          createdDate.getMonth(),
          createdDate.getDate(),
        );

        const extended = orderDetail.extended || 4; // Default 4 nếu null/undefined

        // Tính số ngày đã trôi qua (dương số)
        const daysDifference = Math.floor(
          (currentDateOnly.getTime() - createdDateOnly.getTime()) /
            (1000 * 60 * 60 * 24),
        );

        // Logic mới: Nếu số ngày đã qua >= extended thì hết hạn
        const isExpired = daysDifference >= extended;
        const remainingDays = extended - daysDifference;

        this.logger.log(`📋 Order Detail ID ${orderDetail.id}:`);
        this.logger.log(
          `   📅 Created at: ${this.formatDateTime(orderDetail.created_at)}`,
        );
        this.logger.log(
          `   📅 Created date (chuẩn hóa): ${this.formatDate(createdDateOnly)}`,
        );
        this.logger.log(`   ⏰ Extended: ${extended} ngày`);
        this.logger.log(`   📊 Đã tồn tại: ${daysDifference} ngày`);
        this.logger.log(
          `   🧮 So sánh: ${daysDifference} >= ${extended} → ${isExpired ? 'HẾT HẠN' : 'CÒN HẠN'}`,
        );

        if (isExpired) {
          expiredIds.push(orderDetail.id);
          this.logger.log(`   ❌ Kết quả: HẾT HẠN → SẼ XÓA MỀM`);
        } else {
          this.logger.log(
            `   ✅ Kết quả: CÒN HẠN → GIỮ LẠI (còn ${remainingDays} ngày)`,
          );
        }
        this.logger.log(`   ---`);
      } catch (error) {
        this.logger.error(
          `❌ Lỗi khi xử lý Order Detail ID ${orderDetail.id}:`,
          error.message,
        );
      }
    }

    this.logger.log(`🔢 === KẾT QUẢ TÍNH TOÁN EXTENDED ===`);
    this.logger.log(
      `📊 Tổng số order details kiểm tra: ${orderDetails.length}`,
    );
    this.logger.log(`❌ Số lượng hết hạn cần xóa: ${expiredIds.length}`);
    this.logger.log(
      `✅ Số lượng còn hiệu lực: ${orderDetails.length - expiredIds.length}`,
    );

    if (expiredIds.length > 0) {
      this.logger.log(`🗑️ Danh sách ID sẽ xóa mềm: [${expiredIds.join(', ')}]`);
    }

    return expiredIds;
  }

  /**
   * Thực hiện xóa mềm các order_detail theo batch
   */
  private async softHideOrderDetails(ids: number[]): Promise<number> {
    const time = new Date();
    const reason = 'Hệ Thống Ẩn Tự Động';
    const BATCH_SIZE = 1000; // Batch size để tránh query quá lớn

    this.logger.log(
      `🔄 Bắt đầu ẩn ${ids.length} order details theo batch tại: ${this.formatDateTime(time)}`,
    );

    if (ids.length === 0) {
      this.logger.log('⚠️ Không có ID nào để ẩn');
      return 0;
    }

    let totalAffected = 0;
    const batches = this.chunkArray(ids, BATCH_SIZE);

    this.logger.log(
      `📊 Chia thành ${batches.length} batch(es), mỗi batch tối đa ${BATCH_SIZE} items`,
    );

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      this.logger.log(
        `🔄 Đang xử lý batch ${i + 1}/${batches.length} với ${batch.length} IDs`,
      );

      try {
        const result = await this.orderDetailRepository
          .createQueryBuilder()
          .update(OrderDetail)
          .set({ hidden_at: time, reason })
          .where('id IN (:...ids)', { ids: batch })
          .andWhere('deleted_at IS NULL')
          .execute();

        totalAffected += result.affected || 0;

        this.logger.log(
          `✅ Batch ${i + 1}: Đã cập nhật hidden_at cho ${result.affected} records`,
        );
        this.logger.log(`📋 Batch ${i + 1} IDs: [${batch.join(', ')}]`);

        // Thêm delay nhỏ giữa các batch để tránh overload database
        if (i < batches.length - 1) {
          await this.delay(1000); // 1000ms delay
        }
      } catch (error) {
        this.logger.error(`❌ Lỗi khi xử lý batch ${i + 1}:`, error.message);
        throw error; // Re-throw để không bỏ qua lỗi
      }
    }

    this.logger.log(
      `✅ TỔNG KẾT: Đã cập nhật hidden_at cho ${totalAffected}/${ids.length} records`,
    );
    this.logger.log(`🕐 Hoàn thành tại: ${this.formatDateTime(new Date())}`);
    return totalAffected;
  }

  /**
   * Utility function để chia array thành các chunk nhỏ hơn
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Utility function để delay giữa các batch
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

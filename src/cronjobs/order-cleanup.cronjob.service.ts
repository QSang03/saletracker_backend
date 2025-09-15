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
    try {
      this.logger.log('=== Bắt đầu cronjob kiểm tra order details ===');
      this.logger.log(
        `🕐 Thời gian thực hiện: ${this.formatDateTime(executionStartTime)}`,
      );
      this.logger.log(
        `📅 Ngày hiện tại: ${this.formatDate(executionStartTime)}`,
      );

      // Kiểm tra điều kiện chạy
      const canRun = await this.canRunToday();

      if (!canRun) {
        // KHÔNG được phép chạy cleanup → Gia hạn extended
        this.logger.log(
          '❌ Không được phép chạy cleanup hôm nay → Gia hạn extended',
        );
        await this.extendAllActiveOrderDetails();
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
          await this.softHideOrderDetails(expiredIds);
          this.logger.log(`✅ Đã ẩn ${expiredIds.length} order details`);
        } else {
          this.logger.log('✅ Không có order detail nào cần ẩn');
        }
      }

      const executionEndTime = new Date();
      const executionTime =
        executionEndTime.getTime() - executionStartTime.getTime();
      this.logger.log(`⏱️ Thời gian thực hiện: ${executionTime}ms`);
      this.logger.log('=== Kết thúc cronjob ===');
    } catch (error) {
      this.logger.error(
        '❌ Lỗi trong quá trình thực hiện cronjob:',
        error.stack,
      );
      throw error;
    }
  }

  /**
   * ✅ THÊM MỚI: Gia hạn extended cho tất cả order details khi không chạy được
   * Logic: Khi cronjob không chạy (ngày nghỉ/chủ nhật) thì gia hạn thêm 1 ngày
   */
  private async extendAllActiveOrderDetails(): Promise<void> {
    try {
      this.logger.log('🆙 === BẮT ĐẦU GIA HẠN EXTENDED CHO TẤT CẢ ĐƠN ===');

      // Lấy danh sách order details active
      const orderDetails = await this.getActiveOrderDetails();

      if (orderDetails.length === 0) {
        this.logger.log('📦 Không có order detail nào để gia hạn');
        return;
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

      // Cập nhật extended: Tăng lên 1 hoặc set = 5 nếu null
      const updateResult = await this.orderDetailRepository
        .createQueryBuilder()
        .update(OrderDetail)
        .set({
          extended: () => 'COALESCE(extended, 4) + 1',
          extend_reason: ExtendReason.SYSTEM_SUNDAY_AUTO,
        })
        .where('deleted_at IS NULL')
        .andWhere('hidden_at IS NULL')
        .execute();

      this.logger.log(
        `✅ Đã gia hạn extended cho ${updateResult.affected} order details`,
      );
      this.logger.log(
        `🕐 Thời gian gia hạn: ${this.formatDateTime(new Date())}`,
      );
      this.logger.log('🆙 === KẾT THÚC GIA HẠN EXTENDED ===');
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
      const today = new Date();
      // Sử dụng timezone VN đồng nhất
      const todayStr = today.toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      }); // Format: YYYY-MM-DD
      const dayOfWeek = today.getDay(); // 0 = Chủ nhật, 1 = Thứ 2, ..., 6 = Thứ 7

      this.logger.log(
        `🔍 Kiểm tra điều kiện chạy cho ngày: ${todayStr} (${this.formatDate(today)})`,
      );
      this.logger.log(
        `📅 Thứ trong tuần: ${this.getDayOfWeekName(dayOfWeek)} (${dayOfWeek})`,
      );

      // 1. Kiểm tra chủ nhật
      if (dayOfWeek === 0) {
        this.logger.log('🚫 Hôm nay là chủ nhật - kiểm tra cấu hình');

        const allowSundayRun = await this.isSundayRunAllowed();
        if (!allowSundayRun) {
          this.logger.log(
            '❌ Không được phép chạy vào chủ nhật - sẽ gia hạn thay thế',
          );
          return false;
        }
        this.logger.log('✅ Được cấu hình cho phép chạy chủ nhật');
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
    const currentDate = new Date();

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
        const createdDate = new Date(orderDetail.created_at);

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
  private async softHideOrderDetails(ids: number[]): Promise<void> {
    const time = new Date();
    const reason = 'Hệ Thống Ẩn Tự Động';
    const BATCH_SIZE = 1000; // Batch size để tránh query quá lớn
    
    this.logger.log(`🔄 Bắt đầu ẩn ${ids.length} order details theo batch tại: ${this.formatDateTime(time)}`);
    
    if (ids.length === 0) {
      this.logger.log('⚠️ Không có ID nào để ẩn');
      return;
    }

    let totalAffected = 0;
    const batches = this.chunkArray(ids, BATCH_SIZE);
    
    this.logger.log(`📊 Chia thành ${batches.length} batch(es), mỗi batch tối đa ${BATCH_SIZE} items`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      this.logger.log(`🔄 Đang xử lý batch ${i + 1}/${batches.length} với ${batch.length} IDs`);
      
      try {
        const result = await this.orderDetailRepository
          .createQueryBuilder()
          .update(OrderDetail)
          .set({ hidden_at: time, reason })
          .where('id IN (:...ids)', { ids: batch })
          .andWhere('deleted_at IS NULL')
          .execute();

        totalAffected += result.affected || 0;
        
        this.logger.log(`✅ Batch ${i + 1}: Đã cập nhật hidden_at cho ${result.affected} records`);
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

    this.logger.log(`✅ TỔNG KẾT: Đã cập nhật hidden_at cho ${totalAffected}/${ids.length} records`);
    this.logger.log(`🕐 Hoàn thành tại: ${this.formatDateTime(new Date())}`);
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

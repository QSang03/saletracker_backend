import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { OrderDetail } from '../order-details/order-detail.entity';
import { SystemConfig } from '../system_config/system_config.entity';

@Injectable()
export class OrderCleanupCronjobService {
  private readonly logger = new Logger(OrderCleanupCronjobService.name);

  constructor(
    @InjectRepository(OrderDetail)
    private orderDetailRepository: Repository<OrderDetail>,
    @InjectRepository(SystemConfig)
    private systemConfigRepository: Repository<SystemConfig>,
  ) {}

  // Chạy lúc 18:28 từ thứ 2 đến thứ 7 (không chạy chủ nhật)
  @Cron('00 01 * * 1-6')
  async cleanupExpiredOrderDetails() {
    const executionStartTime = new Date();
    try {
      this.logger.log('=== Bắt đầu cronjob xóa mềm order details hết hạn ===');
      this.logger.log(`🕐 Thời gian thực hiện: ${this.formatDateTime(executionStartTime)}`);
      this.logger.log(`📅 Ngày hiện tại: ${this.formatDate(executionStartTime)}`);

      // Kiểm tra điều kiện chạy (ngày nghỉ + chủ nhật)
      const canRun = await this.canRunToday();
      if (!canRun) {
        this.logger.log('❌ Cronjob không được phép chạy hôm nay');
        return;
      }

      // Lấy danh sách order_detail cần xử lý
      const orderDetails = await this.getActiveOrderDetails();
      this.logger.log(`📦 Tìm thấy ${orderDetails.length} order details cần kiểm tra`);

      // Xử lý từng order detail với công thức mới
      const expiredIds = this.calculateExpiredOrderDetails(orderDetails);
      
      if (expiredIds.length > 0) {
        await this.softDeleteOrderDetails(expiredIds);
        this.logger.log(`✅ Đã xóa mềm ${expiredIds.length} order details`);
      } else {
        this.logger.log('✅ Không có order detail nào cần xóa mềm');
      }

      const executionEndTime = new Date();
      const executionTime = executionEndTime.getTime() - executionStartTime.getTime();
      this.logger.log(`⏱️ Thời gian thực hiện: ${executionTime}ms`);
      this.logger.log('=== Kết thúc cronjob xóa mềm order details ===');

    } catch (error) {
      this.logger.error('❌ Lỗi trong quá trình thực hiện cronjob:', error.stack);
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
      second: '2-digit'
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
      day: '2-digit'
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
        timeZone: 'Asia/Ho_Chi_Minh'
      }); // Format: YYYY-MM-DD
      const dayOfWeek = today.getDay(); // 0 = Chủ nhật, 1 = Thứ 2, ..., 6 = Thứ 7
      
      this.logger.log(`🔍 Kiểm tra điều kiện chạy cho ngày: ${todayStr} (${this.formatDate(today)})`);
      this.logger.log(`📅 Thứ trong tuần: ${this.getDayOfWeekName(dayOfWeek)} (${dayOfWeek})`);

      // 1. Kiểm tra chủ nhật
      if (dayOfWeek === 0) {
        this.logger.log('🚫 Hôm nay là chủ nhật - cronjob được cấu hình không chạy chủ nhật');
        
        const allowSundayRun = await this.isSundayRunAllowed();
        if (!allowSundayRun) {
          this.logger.log('❌ Không được phép chạy vào chủ nhật');
          return false;
        }
        this.logger.log('✅ Được cấu hình cho phép chạy chủ nhật');
      }

      // 2. ✅ SỬA LẠI: Kiểm tra ngày nghỉ với logic đúng
      // Bước 1: Kiểm tra cấu hình tổng quan trước
      const allowHolidayRun = await this.isHolidayRunAllowed();
      this.logger.log(`⚙️ Cấu hình tổng quan cho phép chạy ngày nghỉ: ${allowHolidayRun ? 'Có' : 'Không'}`);
      
      if (!allowHolidayRun) {
        // system_scheduleHoliday = '0' → CHẶN HOÀN TOÀN
        this.logger.log('❌ Không thể chạy: system_scheduleHoliday = 0 (chặn hoàn toàn ngày nghỉ)');
        return false;
      }

      // Bước 2: Nếu allowHolidayRun = true (system_scheduleHoliday = '1')
      // → Kiểm tra chi tiết xem hôm nay có trong danh sách lịch nghỉ không
      const isHoliday = await this.isTodayHoliday();
      this.logger.log(`🏖️ Hôm nay có phải ngày nghỉ cụ thể: ${isHoliday ? 'Có' : 'Không'}`);

      if (isHoliday) {
        this.logger.log('❌ Không thể chạy: Hôm nay có trong danh sách lịch nghỉ cụ thể');
        return false;
      }

      this.logger.log('✅ Được phép chạy cronjob');
      return true;
    } catch (error) {
      this.logger.error('❌ Lỗi khi kiểm tra điều kiện chạy cronjob - MẶC ĐỊNH CHẶN để an toàn:', error.stack);
      // Fail-safe: Có lỗi thì không chạy để an toàn
      return false;
    }
  }

  /**
   * Lấy tên thứ trong tuần
   */
  private getDayOfWeekName(dayOfWeek: number): string {
    const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
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
      this.logger.log(`📋 system_scheduleSunday: ${config?.value || 'null'} → ${result ? 'Cho phép' : 'Không cho phép'}`);
      
      return result;
    } catch (error) {
      this.logger.error('❌ Lỗi kiểm tra system_scheduleSunday:', error.message);
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
      this.logger.log(`📋 system_scheduleHoliday: ${config?.value || 'null'} → ${result ? 'Cho phép kiểm tra chi tiết' : 'Chặn hoàn toàn'}`);
      
      return result;
    } catch (error) {
      this.logger.error('❌ Lỗi kiểm tra system_scheduleHoliday:', error.message);
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
        timeZone: 'Asia/Ho_Chi_Minh'
      }); // Format: YYYY-MM-DD
      
      this.logger.log(`📅 Kiểm tra ngày nghỉ cho: ${today} (VN timezone)`);
      
      const holidayConfigs = await this.systemConfigRepository.find({
        where: [
          { name: 'holiday_multi_days' },
          { name: 'holiday_single_day' },
          { name: 'holiday_separated_days' },
        ],
      });

      this.logger.log(`📋 Tìm thấy ${holidayConfigs.length} cấu hình ngày nghỉ`);

      for (const config of holidayConfigs) {
        if (!config.value) {
          this.logger.log(`⚠️ ${config.name}: Không có giá trị`);
          continue;
        }

        try {
          const holidays = JSON.parse(config.value);
          this.logger.log(`📋 ${config.name}: ${holidays.length} nhóm ngày nghỉ`);
          
          for (const holiday of holidays) {
            if (holiday.dates?.includes(today)) {
              this.logger.log(`🏖️ Tìm thấy ngày nghỉ: ${today} - ${holiday.reason}`);
              return true;
            }
          }
        } catch (parseError) {
          this.logger.error(`❌ Lỗi parse JSON cho ${config.name}:`, parseError.message);
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
      currentDate.getDate()
    );
    
    this.logger.log(`🔢 === BẮT ĐẦU TÍNH TOÁN EXTENDED MỚI ===`);
    this.logger.log(`📅 Ngày hiện tại: ${this.formatDate(currentDate)}`);
    this.logger.log(`🔢 Timestamp hiện tại (đầu ngày): ${currentDateOnly.getTime()}`);
    
    const expiredIds: number[] = [];

    for (const orderDetail of orderDetails) {
      try {
        const createdDate = new Date(orderDetail.created_at);
        
        // Chuẩn hóa created_at về đầu ngày
        const createdDateOnly = new Date(
          createdDate.getFullYear(), 
          createdDate.getMonth(), 
          createdDate.getDate()
        );
        
        const extended = orderDetail.extended || 4; // Default 4 nếu null/undefined
        
        // Tính số ngày đã trôi qua (dương số)
        const daysDifference = Math.floor(
          (currentDateOnly.getTime() - createdDateOnly.getTime()) / (1000 * 60 * 60 * 24)
        );
        
        // Logic mới: Nếu số ngày đã qua >= extended thì hết hạn
        const isExpired = daysDifference >= extended;
        const remainingDays = extended - daysDifference;
        
        this.logger.log(`📋 Order Detail ID ${orderDetail.id}:`);
        this.logger.log(`   📅 Created at: ${this.formatDateTime(orderDetail.created_at)}`);
        this.logger.log(`   📅 Created date (chuẩn hóa): ${this.formatDate(createdDateOnly)}`);
        this.logger.log(`   ⏰ Extended: ${extended} ngày`);
        this.logger.log(`   📊 Đã tồn tại: ${daysDifference} ngày`);
        this.logger.log(`   🧮 So sánh: ${daysDifference} >= ${extended} → ${isExpired ? 'HẾT HẠN' : 'CÒN HẠN'}`);
        
        if (isExpired) {
          expiredIds.push(orderDetail.id);
          this.logger.log(`   ❌ Kết quả: HẾT HẠN → SẼ XÓA MỀM`);
        } else {
          this.logger.log(`   ✅ Kết quả: CÒN HẠN → GIỮ LẠI (còn ${remainingDays} ngày)`);
        }
        this.logger.log(`   ---`);
      } catch (error) {
        this.logger.error(`❌ Lỗi khi xử lý Order Detail ID ${orderDetail.id}:`, error.message);
      }
    }

    this.logger.log(`🔢 === KẾT QUẢ TÍNH TOÁN EXTENDED ===`);
    this.logger.log(`📊 Tổng số order details kiểm tra: ${orderDetails.length}`);
    this.logger.log(`❌ Số lượng hết hạn cần xóa: ${expiredIds.length}`);
    this.logger.log(`✅ Số lượng còn hiệu lực: ${orderDetails.length - expiredIds.length}`);
    
    if (expiredIds.length > 0) {
      this.logger.log(`🗑️ Danh sách ID sẽ xóa mềm: [${expiredIds.join(', ')}]`);
    }

    return expiredIds;
  }

  /**
   * Thực hiện xóa mềm các order_detail
   */
  private async softDeleteOrderDetails(ids: number[]): Promise<void> {
    const deleteTime = new Date();
    const reason = 'Hệ Thống Xóa Tự Động';
    this.logger.log(`🗑️ Bắt đầu xóa mềm tại: ${this.formatDateTime(deleteTime)}`);

    const result = await this.orderDetailRepository
      .createQueryBuilder()
      .update(OrderDetail)
      .set({ deleted_at: deleteTime, reason: reason })
      .where('id IN (:...ids)', { ids })
      .execute();

    this.logger.log(`✅ Đã cập nhật deleted_at cho ${result.affected} records`);
    this.logger.log(`📋 Chi tiết các ID đã xóa: [${ids.join(', ')}]`);
    this.logger.log(`🕐 Thời gian xóa mềm: ${this.formatDateTime(deleteTime)}`);
  }

  /**
   * Manual trigger để test (có thể gọi từ controller)
   */
  async manualCleanup(): Promise<{ 
    success: boolean; 
    deletedCount: number; 
    message: string; 
    executionLog: string[];
    executionTime: number;
  }> {
    const logs: string[] = [];
    const originalLog = this.logger.log.bind(this.logger);
    const startTime = new Date();
    
    // Capture logs để trả về
    this.logger.log = (message: string) => {
      logs.push(`${new Date().toISOString()}: ${message}`);
      originalLog(message);
    };

    try {
      this.logger.log('🔧 Manual trigger cleanup được gọi');
      this.logger.log(`🕐 Thời gian bắt đầu: ${this.formatDateTime(startTime)}`);
      
      // Bỏ qua kiểm tra ngày nghỉ/chủ nhật khi manual trigger
      this.logger.log('⚠️ Manual mode: Bỏ qua kiểm tra ngày nghỉ và chủ nhật');
      
      const orderDetails = await this.getActiveOrderDetails();
      const expiredIds = this.calculateExpiredOrderDetails(orderDetails);
      
      if (expiredIds.length > 0) {
        await this.softDeleteOrderDetails(expiredIds);
      }

      const endTime = new Date();
      const executionTime = endTime.getTime() - startTime.getTime();

      // Restore original log function
      this.logger.log = originalLog;

      return {
        success: true,
        deletedCount: expiredIds.length,
        message: `✅ Đã xóa mềm ${expiredIds.length} order details`,
        executionLog: logs,
        executionTime
      };
    } catch (error) {
      // Restore original log function
      this.logger.log = originalLog;
      
      const endTime = new Date();
      const executionTime = endTime.getTime() - startTime.getTime();
      
      this.logger.error('❌ Lỗi trong manual cleanup:', error.stack);
      return {
        success: false,
        deletedCount: 0,
        message: `❌ Lỗi: ${error.message}`,
        executionLog: logs,
        executionTime
      };
    }
  }

  /**
   * ✅ THÊM MỚI: Debug method để kiểm tra trạng thái hiện tại
   */
  async debugHolidayCheck(): Promise<{
    today: string;
    dayOfWeek: string;
    dayOfWeekNumber: number;
    isHoliday: boolean;
    allowHoliday: boolean;
    allowSunday: boolean;
    canRun: boolean;
    configs: any[];
  }> {
    const today = new Date();
    const todayStr = today.toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh'
    });
    const dayOfWeek = today.getDay();
    
    const isHoliday = await this.isTodayHoliday();
    const allowHoliday = await this.isHolidayRunAllowed();
    const allowSunday = await this.isSundayRunAllowed();
    const canRun = await this.canRunToday();
    
    const configs = await this.systemConfigRepository.find({
      where: [
        { name: 'system_scheduleHoliday' },
        { name: 'system_scheduleSunday' },
        { name: 'holiday_multi_days' },
        { name: 'holiday_single_day' },
        { name: 'holiday_separated_days' },
      ]
    });
    
    return {
      today: todayStr,
      dayOfWeek: this.getDayOfWeekName(dayOfWeek),
      dayOfWeekNumber: dayOfWeek,
      isHoliday,
      allowHoliday,
      allowSunday,
      canRun,
      configs
    };
  }

  /**
   * Thêm method để check status của cronjob
   */
  async getCleanupStatus(): Promise<{
    canRunToday: boolean;
    todayInfo: {
      date: string;
      dayOfWeek: string;
      isSunday: boolean;
      isHoliday: boolean;
    };
    settings: {
      allowSunday: boolean;
      allowHoliday: boolean;
    };
    activeOrdersCount: number;
  }> {
    const today = new Date();
    const dayOfWeek = today.getDay();
    
    const canRunToday = await this.canRunToday();
    const isHoliday = await this.isTodayHoliday();
    const allowSunday = await this.isSundayRunAllowed();
    const allowHoliday = await this.isHolidayRunAllowed();
    
    const activeOrders = await this.getActiveOrderDetails();

    return {
      canRunToday,
      todayInfo: {
        date: this.formatDate(today),
        dayOfWeek: this.getDayOfWeekName(dayOfWeek),
        isSunday: dayOfWeek === 0,
        isHoliday,
      },
      settings: {
        allowSunday,
        allowHoliday,
      },
      activeOrdersCount: activeOrders.length,
    };
  }
}

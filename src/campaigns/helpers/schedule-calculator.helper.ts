import { CampaignType } from '../campaign.entity';
import { 
  ScheduleType, 
  DailyDatesConfig, 
  HourlySlotsConfig,
  ScheduleStatus 
} from '../../campaign_departments_schedules/campaign_departments_schedules.entity';

/**
 * Helper class để tính toán schedule cho campaigns
 * Xử lý logic mapping giữa campaign types và schedule types
 */
export class ScheduleCalculatorHelper {
  
  /**
   * Map campaign type với schedule type tương ứng
   * @param campaignType - Loại campaign
   * @returns Schedule type phù hợp
   */
  static getScheduleTypeByCampaignType(campaignType: CampaignType): ScheduleType {
    const mapping = {
      [CampaignType.HOURLY_KM]: ScheduleType.DAILY_DATES,
      [CampaignType.DAILY_KM]: ScheduleType.DAILY_DATES,
      [CampaignType.THREE_DAY_KM]: ScheduleType.HOURLY_SLOTS,
      [CampaignType.WEEKLY_SP]: ScheduleType.HOURLY_SLOTS,
      [CampaignType.WEEKLY_BBG]: ScheduleType.HOURLY_SLOTS,
    };
    
    const scheduleType = mapping[campaignType];
    if (!scheduleType) {
      throw new Error(`Không hỗ trợ campaign type: ${campaignType}`);
    }
    
    return scheduleType;
  }

  /**
   * Tính toán date range từ daily dates config
   * Logic: từ 8h sáng ngày đầu tiên đến 17h45 ngày cuối cùng
   * @param scheduleConfig - Cấu hình daily dates
   * @returns Object chứa startDate và endDate
   */
  static calculateDateRangeFromDailyDates(scheduleConfig: DailyDatesConfig): {startDate: Date, endDate: Date} {
    if (!scheduleConfig.dates || scheduleConfig.dates.length === 0) {
      throw new Error('Schedule config không có dates hoặc dates rỗng');
    }

    // Tạo array các Date objects từ config
    const dates = scheduleConfig.dates.map(d => {
      const year = d.year || new Date().getFullYear();
      const month = d.month || new Date().getMonth() + 1;
      
      // Validate date values
      if (d.day_of_month < 1 || d.day_of_month > 31) {
        throw new Error(`Ngày không hợp lệ: ${d.day_of_month}`);
      }
      if (month < 1 || month > 12) {
        throw new Error(`Tháng không hợp lệ: ${month}`);
      }
      
      return new Date(year, month - 1, d.day_of_month);
    });
    
    // Tìm ngày sớm nhất và muộn nhất
    const earliestDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const latestDate = new Date(Math.max(...dates.map(d => d.getTime())));
    
    // Set start time: 8:00 AM của ngày đầu tiên
    const startDate = new Date(earliestDate);
    startDate.setHours(8, 0, 0, 0);
    
    // Set end time: 17:45 PM của ngày cuối cùng
    const endDate = new Date(latestDate);
    endDate.setHours(17, 45, 0, 0);
    
    return { startDate, endDate };
  }

  /**
   * Tính toán date range từ hourly slots config
   * Logic: từ start_time sớm nhất đến end_time muộn nhất trong tuần
   * @param scheduleConfig - Cấu hình hourly slots
   * @returns Object chứa startDate và endDate
   */
  static calculateDateRangeFromHourlySlots(scheduleConfig: HourlySlotsConfig): {startDate: Date, endDate: Date} {
    if (!scheduleConfig.slots || scheduleConfig.slots.length === 0) {
      throw new Error('Schedule config không có slots hoặc slots rỗng');
    }

    const now = new Date();
    
    // Tính toán ngày đầu tuần (Thứ 2)
    const currentWeekStart = new Date(now);
    const dayOfWeek = now.getDay();
    const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Chủ nhật = 0, cần chuyển thành 6
    currentWeekStart.setDate(now.getDate() - daysFromMonday);
    currentWeekStart.setHours(0, 0, 0, 0);
    
    const slots = scheduleConfig.slots;
    
    // Tìm slot sớm nhất (day_of_week nhỏ nhất, nếu bằng thì start_time sớm nhất)
    const earliestSlot = slots.reduce((min, slot) => {
      if (!slot.day_of_week || !slot.start_time) {
        return min;
      }
      
      if (!min.day_of_week || !min.start_time) {
        return slot;
      }
      
      if (slot.day_of_week < min.day_of_week || 
          (slot.day_of_week === min.day_of_week && slot.start_time < min.start_time)) {
        return slot;
      }
      return min;
    });
    
    // Tìm slot muộn nhất (day_of_week lớn nhất, nếu bằng thì end_time muộn nhất)
    const latestSlot = slots.reduce((max, slot) => {
      if (!slot.day_of_week || !slot.end_time) {
        return max;
      }
      
      if (!max.day_of_week || !max.end_time) {
        return slot;
      }
      
      if (slot.day_of_week > max.day_of_week || 
          (slot.day_of_week === max.day_of_week && slot.end_time > max.end_time)) {
        return slot;
      }
      return max;
    });

    if (!earliestSlot.day_of_week || !earliestSlot.start_time) {
      throw new Error('Không tìm thấy slot hợp lệ cho start date');
    }
    
    if (!latestSlot.day_of_week || !latestSlot.end_time) {
      throw new Error('Không tìm thấy slot hợp lệ cho end date');
    }
    
    // Tính start date
    const startDate = new Date(currentWeekStart);
    // day_of_week: 2=Thứ2, 3=Thứ3, ..., 7=Thứ7 (không có Chủ nhật)
    const startDayOffset = earliestSlot.day_of_week - 2; // 2->0, 3->1, ..., 7->5
    startDate.setDate(startDate.getDate() + startDayOffset);
    
    const [startHour, startMin] = earliestSlot.start_time.split(':').map(Number);
    if (isNaN(startHour) || isNaN(startMin)) {
      throw new Error(`Format start_time không hợp lệ: ${earliestSlot.start_time}`);
    }
    startDate.setHours(startHour, startMin, 0, 0);
    
    // Tính end date
    const endDate = new Date(currentWeekStart);
    const endDayOffset = latestSlot.day_of_week - 2; // 2->0, 3->1, ..., 7->5
    endDate.setDate(endDate.getDate() + endDayOffset);
    
    const [endHour, endMin] = latestSlot.end_time.split(':').map(Number);
    if (isNaN(endHour) || isNaN(endMin)) {
      throw new Error(`Format end_time không hợp lệ: ${latestSlot.end_time}`);
    }
    endDate.setHours(endHour, endMin, 0, 0);
    
    return { startDate, endDate };
  }

  /**
   * Validate xem schedule type có phù hợp với campaign type không
   * @param campaignType - Loại campaign
   * @param scheduleType - Loại schedule
   * @returns true nếu hợp lệ
   */
  static isValidScheduleForCampaign(campaignType: CampaignType, scheduleType: ScheduleType): boolean {
    const expectedScheduleType = this.getScheduleTypeByCampaignType(campaignType);
    return expectedScheduleType === scheduleType;
  }

  /**
   * Check xem thời gian hiện tại có nằm trong schedule không
   * @param scheduleConfig - Cấu hình schedule
   * @param scheduleType - Loại schedule
   * @param currentTime - Thời gian hiện tại (optional, mặc định là now)
   * @returns true nếu hiện tại trong khung thời gian cho phép
   */
  static isCurrentTimeInSchedule(
    scheduleConfig: DailyDatesConfig | HourlySlotsConfig, 
    scheduleType: ScheduleType,
    currentTime: Date = new Date()
  ): boolean {
    try {
      let dateRange: {startDate: Date, endDate: Date};
      
      if (scheduleType === ScheduleType.DAILY_DATES) {
        dateRange = this.calculateDateRangeFromDailyDates(scheduleConfig as DailyDatesConfig);
      } else {
        dateRange = this.calculateDateRangeFromHourlySlots(scheduleConfig as HourlySlotsConfig);
      }
      
      return currentTime >= dateRange.startDate && currentTime <= dateRange.endDate;
    } catch (error) {
      // Nếu có lỗi trong việc tính toán, coi như không hợp lệ
      return false;
    }
  }

  /**
   * Lấy thông tin chi tiết về schedule timing
   * @param scheduleConfig - Cấu hình schedule
   * @param scheduleType - Loại schedule
   * @returns Object chứa thông tin chi tiết
   */
  static getScheduleDetails(
    scheduleConfig: DailyDatesConfig | HourlySlotsConfig, 
    scheduleType: ScheduleType
  ): {
    startDate: Date;
    endDate: Date;
    isCurrentlyActive: boolean;
    timeUntilStart?: number; // milliseconds
    timeUntilEnd?: number; // milliseconds
  } {
    let dateRange: {startDate: Date, endDate: Date};
    
    if (scheduleType === ScheduleType.DAILY_DATES) {
      dateRange = this.calculateDateRangeFromDailyDates(scheduleConfig as DailyDatesConfig);
    } else {
      dateRange = this.calculateDateRangeFromHourlySlots(scheduleConfig as HourlySlotsConfig);
    }
    
    const now = new Date();
    const isCurrentlyActive = now >= dateRange.startDate && now <= dateRange.endDate;
    
    const result: any = {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      isCurrentlyActive,
    };
    
    if (now < dateRange.startDate) {
      result.timeUntilStart = dateRange.startDate.getTime() - now.getTime();
    }
    
    if (now < dateRange.endDate) {
      result.timeUntilEnd = dateRange.endDate.getTime() - now.getTime();
    }
    
    return result;
  }
}

import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { Campaign, CampaignStatus, CampaignType } from './campaign.entity';
import { Department } from '../departments/department.entity';
import {
  CreateCampaignDto,
  CustomerDto,
  ScheduleConfigDto,
} from './campaign.dto';
import { User } from '../users/user.entity';
import { CampaignCustomerMap } from '../campaign_customer_map/campaign_customer_map.entity';
import { CampaignInteractionLog } from '../campaign_interaction_logs/campaign_interaction_log.entity';
import { CampaignContent } from '../campaign_contents/campaign_content.entity';
import { CampaignSchedule } from '../campaign_schedules/campaign_schedule.entity';
import { CampaignEmailReport } from '../campaign_email_reports/campaign_email_report.entity';
import { CampaignCustomer } from '../campaign_customers/campaign_customer.entity';
import {
  DepartmentSchedule,
  ScheduleType,
  ScheduleStatus,
} from '../campaign_departments_schedules/campaign_departments_schedules.entity';
import {
  PromoMessageFlow,
  InitialMessage,
  ReminderMessage,
} from '../campaign_config/promo_message';
import { ScheduleCalculatorHelper } from './helpers/schedule-calculator.helper';
import * as ExcelJS from 'exceljs';

export interface CampaignWithDetails extends Campaign {
  customer_count?: number;

  messages: {
    type: 'initial';
    text: string;
    attachment?: {
      type: 'image' | 'link' | 'file';
      url?: string;
      base64?: string;
      filename?: string;
    } | null;
  };

  schedule_config: {
    type: 'hourly' | '3_day' | 'weekly';
    start_time?: string;
    end_time?: string;
    remind_after_minutes?: number;
    days_of_week?: number[];
    day_of_week?: number;
    time_of_day?: string;
  };

  reminders: Array<{
    content: string;
    minutes: number;
  }>;

  email_reports?: {
    recipients_to: string;
    recipients_cc?: string[];
    report_interval_minutes?: number;
    stop_sending_at_time?: string;
    is_active: boolean;
    send_when_campaign_completed: boolean;
  };

  customers: Array<{
    phone_number: string;
    full_name: string;
    salutation?: string;
  }>;

  // Thêm start_date và end_date lấy từ campaign schedule
  start_date?: string;
  end_date?: string;
}

export interface CampaignResponse {
  data: CampaignWithDetails[];
  total: number;
  stats: {
    totalCampaigns: number;
    draftCampaigns: number;
    runningCampaigns: number;
    completedCampaigns: number;
  };
}

// Interface cho filters
export interface CampaignFilters {
  search?: string;
  campaignTypes?: string[];
  statuses?: string[];
  createdBy?: number[];
  page?: number;
  pageSize?: number;
  employees?: string[]; // Thay đổi từ createdBy
  departments?: string[]; // Thêm mới
  singleDate?: string; // Thêm mới - format YYYY-MM-DD
}

@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);

  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(CampaignCustomerMap)
    private readonly campaignCustomerMapRepository: Repository<CampaignCustomerMap>,
    @InjectRepository(CampaignInteractionLog)
    private readonly campaignLogRepository: Repository<CampaignInteractionLog>,
    @InjectRepository(CampaignContent)
    private readonly campaignContentRepository: Repository<CampaignContent>,
    @InjectRepository(CampaignSchedule)
    private readonly campaignScheduleRepository: Repository<CampaignSchedule>,
    @InjectRepository(CampaignEmailReport)
    private readonly campaignEmailReportRepository: Repository<CampaignEmailReport>,
    @InjectRepository(CampaignCustomer)
    private readonly campaignCustomerRepository: Repository<CampaignCustomer>,
    @InjectRepository(DepartmentSchedule)
    private readonly departmentScheduleRepository: Repository<DepartmentSchedule>,
  ) {}

  /**
   * Lấy schedule active của department cho campaign type cụ thể
   * @param departmentId - ID của department
   * @param campaignType - Loại campaign
   * @returns DepartmentSchedule active hoặc null
   */
  private async getDepartmentActiveSchedule(
    departmentId: number,
    campaignType: CampaignType,
  ): Promise<DepartmentSchedule | null> {
    const requiredScheduleType =
      ScheduleCalculatorHelper.getScheduleTypeByCampaignType(campaignType);
    this.logger.log(
      `🔍 [getDepartmentActiveSchedule] Looking for schedule - Department ID: ${departmentId}, Campaign Type: ${campaignType}, Required Schedule Type: ${requiredScheduleType}`,
    );

    const schedule = await this.departmentScheduleRepository.findOne({
      where: {
        department: { id: departmentId },
        schedule_type: requiredScheduleType,
        status: ScheduleStatus.ACTIVE,
      },
      relations: ['department'],
    });

    if (schedule) {
      this.logger.log(
        `✅ [getDepartmentActiveSchedule] Found active schedule: ${schedule.name} (ID: ${schedule.id})`,
      );
    } else {
      this.logger.warn(
        `❌ [getDepartmentActiveSchedule] No active schedule found for department ${departmentId} with type ${requiredScheduleType}`,
      );

      // Let's also check what schedules exist for this department
      const allSchedules = await this.departmentScheduleRepository.find({
        where: { department: { id: departmentId } },
        relations: ['department'],
      });
      this.logger.debug(
        `🔍 [getDepartmentActiveSchedule] All schedules for department ${departmentId}:`,
        allSchedules.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.schedule_type,
          status: s.status,
        })),
      );
    }

    return schedule;
  }

  /**
   * Validate campaign schedule config nằm trong department schedule
   * @param campaignScheduleConfig - Cấu hình schedule của campaign
   * @param departmentScheduleConfig - Cấu hình schedule của department
   * @param scheduleType - Loại schedule
   * @returns true nếu campaign schedule nằm trong department schedule
   */
  private validateCampaignScheduleAgainstDepartment(
    campaignScheduleConfig: any,
    departmentScheduleConfig: any,
    scheduleType: ScheduleType,
  ): boolean {
    try {
      if (scheduleType === ScheduleType.DAILY_DATES) {
        return this.validateDailyDatesConfig(
          campaignScheduleConfig,
          departmentScheduleConfig,
        );
      } else {
        // For hourly_slots department schedule, check campaign config type
        if (campaignScheduleConfig.type === 'weekly') {
          return this.validateWeeklyScheduleConfig(
            campaignScheduleConfig,
            departmentScheduleConfig,
          );
        } else if (campaignScheduleConfig.type === 'hourly') {
          return this.validateHourlyScheduleConfig(
            campaignScheduleConfig,
            departmentScheduleConfig,
          );
        } else if (campaignScheduleConfig.type === '3_day') {
          return this.validate3DayScheduleConfig(
            campaignScheduleConfig,
            departmentScheduleConfig,
          );
        } else {
          return this.validateHourlySlotsConfig(
            campaignScheduleConfig,
            departmentScheduleConfig,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Error validating campaign schedule config: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Validate daily dates config
   * @param campaignConfig - Campaign schedule config
   * @param departmentConfig - Department schedule config
   * @returns true nếu hợp lệ
   */
  private validateDailyDatesConfig(
    campaignConfig: any,
    departmentConfig: any,
  ): boolean {
    // For daily_dates department schedule, campaign config format doesn't matter
    // The campaign will run within the dates specified in department schedule
    // We just need to make sure department has valid dates
    if (!departmentConfig?.dates || !Array.isArray(departmentConfig.dates)) {
      this.logger.warn(`Department schedule has no valid dates configuration`);
      return false;
    }

    // Check if there are any valid dates for today or future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const hasValidDates = departmentConfig.dates.some((deptDate: any) => {
      const year = deptDate.year || today.getFullYear();
      const month = deptDate.month || today.getMonth() + 1;
      const dateObj = new Date(year, month - 1, deptDate.day_of_month);
      return dateObj >= today;
    });

    if (!hasValidDates) {
      this.logger.warn(`Department schedule has no valid future dates`);
      return false;
    }

    this.logger.log(
      `✅ Daily dates validation passed - campaign can run within department schedule dates`
    );
    return true;
  }

  /**
   * Validate hourly slots config
   * @param campaignConfig - Campaign schedule config
   * @param departmentConfig - Department schedule config
   * @returns true nếu hợp lệ
   */
  private validateHourlySlotsConfig(
    campaignConfig: any,
    departmentConfig: any,
  ): boolean {
    if (!campaignConfig?.slots || !departmentConfig?.slots) {
      return false;
    }

    // Check mỗi slot trong campaign config có nằm trong department config không
    for (const campaignSlot of campaignConfig.slots) {
      const found = departmentConfig.slots.some((deptSlot: any) => {
        // Check day_of_week trùng khớp
        if (deptSlot.day_of_week !== campaignSlot.day_of_week) {
          return false;
        }

        // Check time range của campaign có nằm trong department không
        const deptStart = this.parseTime(deptSlot.start_time);
        const deptEnd = this.parseTime(deptSlot.end_time);
        const campaignStart = this.parseTime(campaignSlot.start_time);
        const campaignEnd = this.parseTime(campaignSlot.end_time);

        return campaignStart >= deptStart && campaignEnd <= deptEnd;
      });

      if (!found) {
        this.logger.warn(
          `Campaign slot day_of_week: ${campaignSlot.day_of_week}, ` +
            `time: ${campaignSlot.start_time}-${campaignSlot.end_time} ` +
            `not found within department schedule slots`,
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Validate weekly schedule config against hourly slots
   * @param campaignConfig - Campaign weekly schedule config
   * @param departmentConfig - Department hourly slots config
   * @returns true nếu hợp lệ
   */
  private validateWeeklyScheduleConfig(
    campaignConfig: any,
    departmentConfig: any,
  ): boolean {
    if (!campaignConfig?.day_of_week || !campaignConfig?.time_of_day || !departmentConfig?.slots) {
      this.logger.warn(`Missing required fields in weekly schedule config`);
      return false;
    }

    const campaignDay = campaignConfig.day_of_week;
    const campaignTime = campaignConfig.time_of_day;

    // Tìm slot trong department schedule có cùng day_of_week và time nằm trong range
    const found = departmentConfig.slots.some((deptSlot: any) => {
      // Check day_of_week trùng khớp
      if (deptSlot.day_of_week !== campaignDay) {
        return false;
      }

      // Check thời gian campaign có nằm trong slot range không
      const deptStart = this.parseTime(deptSlot.start_time);
      const deptEnd = this.parseTime(deptSlot.end_time);
      const campaignTimeParsed = this.parseTime(campaignTime);

      // Campaign time phải nằm trong khoảng [start_time, end_time)
      const isTimeValid = campaignTimeParsed >= deptStart && campaignTimeParsed < deptEnd;
      
      if (isTimeValid) {
        this.logger.log(
          `✅ Weekly schedule valid: day_of_week=${campaignDay}, time=${campaignTime} ` +
          `found in slot ${deptSlot.start_time}-${deptSlot.end_time}`
        );
      }
      
      return isTimeValid;
    });

    if (!found) {
      this.logger.warn(
        `❌ Weekly schedule invalid: day_of_week=${campaignDay}, time=${campaignTime} ` +
        `not found within any department schedule slots`
      );
      return false;
    }

    return true;
  }

  /**
   * Validate hourly schedule config against hourly slots
   * @param campaignConfig - Campaign hourly schedule config
   * @param departmentConfig - Department hourly slots config
   * @returns true nếu hợp lệ
   */
  private validateHourlyScheduleConfig(
    campaignConfig: any,
    departmentConfig: any,
  ): boolean {
    if (!campaignConfig?.start_time || !campaignConfig?.end_time || !departmentConfig?.slots) {
      this.logger.warn(`Missing required fields in hourly schedule config`);
      return false;
    }

    const campaignStart = campaignConfig.start_time;
    const campaignEnd = campaignConfig.end_time;
    const campaignStartParsed = this.parseTime(campaignStart);
    const campaignEndParsed = this.parseTime(campaignEnd);

    // Tìm slots trong department schedule mà campaign time range có thể fit vào
    const validSlots = departmentConfig.slots.filter((deptSlot: any) => {
      const deptStart = this.parseTime(deptSlot.start_time);
      const deptEnd = this.parseTime(deptSlot.end_time);

      // Campaign time range phải nằm hoàn toàn trong department slot
      return campaignStartParsed >= deptStart && campaignEndParsed <= deptEnd;
    });

    if (validSlots.length === 0) {
      this.logger.warn(
        `❌ Hourly schedule invalid: time range ${campaignStart}-${campaignEnd} ` +
        `not found within any department schedule slots`
      );
      return false;
    }

    this.logger.log(
      `✅ Hourly schedule valid: time range ${campaignStart}-${campaignEnd} ` +
      `found in ${validSlots.length} department slot(s)`
    );
    return true;
  }

  /**
   * Validate 3-day schedule config against hourly slots
   * @param campaignConfig - Campaign 3-day schedule config
   * @param departmentConfig - Department hourly slots config
   * @returns true nếu hợp lệ
   */
  private validate3DayScheduleConfig(
    campaignConfig: any,
    departmentConfig: any,
  ): boolean {
    if (!campaignConfig?.days_of_week || !campaignConfig?.time_of_day || !departmentConfig?.slots) {
      this.logger.warn(`Missing required fields in 3-day schedule config`);
      return false;
    }

    const campaignDays = campaignConfig.days_of_week;
    const campaignTime = campaignConfig.time_of_day;
    const campaignTimeParsed = this.parseTime(campaignTime);

    // Kiểm tra từng ngày trong days_of_week
    for (const dayOfWeek of campaignDays) {
      const found = departmentConfig.slots.some((deptSlot: any) => {
        // Check day_of_week trùng khớp
        if (deptSlot.day_of_week !== dayOfWeek) {
          return false;
        }

        // Check thời gian campaign có nằm trong slot range không
        const deptStart = this.parseTime(deptSlot.start_time);
        const deptEnd = this.parseTime(deptSlot.end_time);

        // Campaign time phải nằm trong khoảng [start_time, end_time)
        return campaignTimeParsed >= deptStart && campaignTimeParsed < deptEnd;
      });

      if (!found) {
        this.logger.warn(
          `❌ 3-day schedule invalid: day_of_week=${dayOfWeek}, time=${campaignTime} ` +
          `not found within any department schedule slots`
        );
        return false;
      }
    }

    this.logger.log(
      `✅ 3-day schedule valid: days=[${campaignDays.join(',')}], time=${campaignTime} ` +
      `all days found in department schedule slots`
    );
    return true;
  }

  /**
   * Parse time string to minutes for comparison
   * @param timeStr - Time string in format "HH:MM"
   * @returns Number of minutes since midnight
   */
  private parseTime(timeStr: string): number {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Setup campaign schedule dates (không validate thời gian hiện tại)
   * Dùng khi chuyển DRAFT → SCHEDULED
   * @param campaign - Campaign cần setup
   */
  private async setupCampaignScheduleDates(campaign: Campaign): Promise<void> {
    this.logger.log(
      `🔧 [setupCampaignScheduleDates] Setting up schedule for campaign ${campaign.id}`,
    );
    this.logger.log(
      `🔧 [setupCampaignScheduleDates] Campaign Type: ${campaign.campaign_type}, Department ID: ${campaign.department.id}`,
    );

    // 1. Get department schedule
    const departmentSchedule = await this.getDepartmentActiveSchedule(
      campaign.department.id,
      campaign.campaign_type,
    );

    if (!departmentSchedule) {
      const requiredScheduleType =
        ScheduleCalculatorHelper.getScheduleTypeByCampaignType(
          campaign.campaign_type,
        );
      this.logger.error(
        `❌ [setupCampaignScheduleDates] No active schedule found for department ${campaign.department.id}, required type: ${requiredScheduleType}`,
      );
      throw new Error('chưa có lịch hoạt động');
    }

    this.logger.log(
      `✅ [setupCampaignScheduleDates] Found schedule: ${departmentSchedule.name} (ID: ${departmentSchedule.id})`,
    );
    this.logger.log(
      `✅ [setupCampaignScheduleDates] Schedule Type: ${departmentSchedule.schedule_type}, Status: ${departmentSchedule.status}`,
    );
    this.logger.debug(
      `🔧 [setupCampaignScheduleDates] Schedule Config: ${JSON.stringify(departmentSchedule.schedule_config, null, 2)}`,
    );

    // 2. Validate campaign schedule config nằm trong department schedule
    const campaignSchedule = await this.campaignScheduleRepository.findOne({
      where: { campaign: { id: campaign.id } },
    });

    let shouldSetNullDates = false; // Flag để xác định có set null dates không

    if (campaignSchedule?.schedule_config) {
      this.logger.log(
        `🔍 [setupCampaignScheduleDates] Validating campaign schedule config against department schedule...`,
      );

      const isValidConfig = this.validateCampaignScheduleAgainstDepartment(
        campaignSchedule.schedule_config,
        departmentSchedule.schedule_config,
        departmentSchedule.schedule_type,
      );

      if (!isValidConfig) {
        this.logger.warn(
          `⚠️ [setupCampaignScheduleDates] Campaign schedule config is not within department schedule limits - will set dates to null`,
        );
        shouldSetNullDates = true;
      } else {
        this.logger.log(
          `✅ [setupCampaignScheduleDates] Campaign schedule config is valid within department schedule`,
        );
      }
    } else {
      this.logger.log(
        `⚠️ [setupCampaignScheduleDates] No campaign schedule config found - using department schedule directly`,
      );
    }

    // 3. Calculate date range hoặc set null dates
    if (shouldSetNullDates) {
      // Set dates thành null nếu campaign schedule không hợp lệ
      this.logger.log(
        `🚫 [setupCampaignScheduleDates] Setting dates to null due to invalid schedule config`,
      );
      await this.updateCampaignScheduleDates(campaign.id, null, null);
      this.logger.log(
        `✅ [setupCampaignScheduleDates] Campaign schedule dates set to null successfully`,
      );
    } else {
      // Tính toán dates bình thường
      let dateRange: { startDate: Date; endDate: Date };

      try {
        if (departmentSchedule.schedule_type === ScheduleType.DAILY_DATES) {
          this.logger.log(
            `📅 [setupCampaignScheduleDates] Calculating daily dates range...`,
          );
          dateRange = ScheduleCalculatorHelper.calculateDateRangeFromDailyDates(
            departmentSchedule.schedule_config as any,
          );
        } else {
          this.logger.log(
            `⏰ [setupCampaignScheduleDates] Calculating hourly slots range...`,
          );
          dateRange =
            ScheduleCalculatorHelper.calculateDateRangeFromHourlySlots(
              departmentSchedule.schedule_config as any,
            );
        }
        this.logger.log(
          `✅ [setupCampaignScheduleDates] Date range calculated:`,
        );
        this.logger.log(`   Start: ${dateRange.startDate.toISOString()}`);
        this.logger.log(`   End: ${dateRange.endDate.toISOString()}`);

        // Update campaign schedule với calculated dates
        this.logger.log(
          `💾 [setupCampaignScheduleDates] Updating campaign schedule dates...`,
        );
        await this.updateCampaignScheduleDates(
          campaign.id,
          dateRange.startDate,
          dateRange.endDate,
        );
        this.logger.log(
          `✅ [setupCampaignScheduleDates] Campaign schedule dates updated successfully`,
        );
      } catch (error) {
        this.logger.error(
          `❌ [setupCampaignScheduleDates] Error calculating date range:`,
          error,
        );
        throw new Error('Lỗi tính toán thời gian');
      }
    }
  }

  /**
   * Validate thời gian hiện tại có trong schedule không
   * Dùng khi chuyển SCHEDULED → RUNNING
   * @param campaign - Campaign cần validate
   */
  private async validateCurrentTimeInSchedule(
    campaign: Campaign,
  ): Promise<void> {
    this.logger.log(
      `⏱️ [validateCurrentTimeInSchedule] Validating current time for campaign ${campaign.id}`,
    );

    // Get existing campaign schedule
    const campaignSchedule = await this.campaignScheduleRepository.findOne({
      where: { campaign: { id: campaign.id } },
    });

    if (
      !campaignSchedule ||
      !campaignSchedule.start_date ||
      !campaignSchedule.end_date
    ) {
      throw new Error('chưa có lịch trình');
    }

    const startDate = new Date(campaignSchedule.start_date);
    const endDate = new Date(campaignSchedule.end_date);
    const now = new Date();

    this.logger.log(
      `⏱️ [validateCurrentTimeInSchedule] Time validation: ${now.toISOString()} should be between ${startDate.toISOString()} and ${endDate.toISOString()}`,
    );

    if (now < startDate || now > endDate) {
      this.logger.error(
        `❌ [validateCurrentTimeInSchedule] Time validation failed - outside allowed range`,
      );
      throw new Error('không trong khung thời gian');
    }

    this.logger.log(
      `✅ [validateCurrentTimeInSchedule] Time validation passed`,
    );

    // Check concurrent campaigns
    await this.validateNoConcurrentCampaigns(
      campaign.department.id,
      campaign.id,
      {
        startDate,
        endDate,
      },
    );
  }

  /**
   * Validate và setup campaign schedule khi chuyển sang RUNNING
   * @param campaign - Campaign cần validate
   */
  private async validateAndSetupCampaignSchedule(
    campaign: Campaign,
  ): Promise<void> {

    // 1. Get department schedule
    const departmentSchedule = await this.getDepartmentActiveSchedule(
      campaign.department.id,
      campaign.campaign_type,
    );

    if (!departmentSchedule) {
      const requiredScheduleType =
        ScheduleCalculatorHelper.getScheduleTypeByCampaignType(
          campaign.campaign_type,
        );
      throw new BadRequestException(
        `Phòng ban "${campaign.department.name}" chưa có lịch hoạt động loại "${requiredScheduleType}" cho chiến dịch loại "${campaign.campaign_type}". ` +
          `Vui lòng tạo lịch hoạt động trước khi chạy chiến dịch.`,
      );
    }

    // 2. Calculate date range từ schedule config
    let dateRange: { startDate: Date; endDate: Date };

    try {
      if (departmentSchedule.schedule_type === ScheduleType.DAILY_DATES) {
        dateRange = ScheduleCalculatorHelper.calculateDateRangeFromDailyDates(
          departmentSchedule.schedule_config as any,
        );
      } else {
        dateRange = ScheduleCalculatorHelper.calculateDateRangeFromHourlySlots(
          departmentSchedule.schedule_config as any,
        );
      }
    } catch (error) {
      throw new BadRequestException(
        `Lỗi khi tính toán thời gian từ cấu hình lịch: ${error.message}`,
      );
    }

    const now = new Date();

    if (now < dateRange.startDate || now > dateRange.endDate) {
      const formatOptions: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
      };

      throw new BadRequestException(
        `Chiến dịch chỉ có thể chạy trong khung thời gian từ ` +
          `${dateRange.startDate.toLocaleString('vi-VN', formatOptions)} ` +
          `đến ${dateRange.endDate.toLocaleString('vi-VN', formatOptions)}. ` +
          `Thời gian hiện tại: ${now.toLocaleString('vi-VN', formatOptions)}`,
      );
    }

    // 4. Check xem có campaign khác của cùng department đang chạy trong cùng time slot không
    await this.validateNoConcurrentCampaigns(
      campaign.department.id,
      campaign.id,
      dateRange,
    );

    await this.updateCampaignScheduleDates(
      campaign.id,
      dateRange.startDate,
      dateRange.endDate,
    );
  }

  /**
   * Validate không có campaign khác chạy cùng lúc
   * @param departmentId - ID department
   * @param currentCampaignId - ID campaign hiện tại (để exclude)
   * @param dateRange - Khung thời gian cần check
   */
  private async validateNoConcurrentCampaigns(
    departmentId: number,
    currentCampaignId: string,
    dateRange: { startDate: Date; endDate: Date },
  ): Promise<void> {
    const concurrentCampaigns = await this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoin('campaign.department', 'department')
      .leftJoin(
        'campaign_schedules',
        'schedule',
        'schedule.campaign_id = campaign.id',
      )
      .where('campaign.id != :currentId', { currentId: currentCampaignId })
      .andWhere('department.id = :departmentId', { departmentId })
      .andWhere('campaign.status IN (:...statuses)', {
        statuses: [CampaignStatus.RUNNING, CampaignStatus.SCHEDULED],
      })
      .andWhere(
        '(schedule.start_date <= :endDate AND schedule.end_date >= :startDate)',
        {
          startDate: dateRange.startDate.toISOString(),
          endDate: dateRange.endDate.toISOString(),
        },
      )
      .getMany();

    if (concurrentCampaigns.length > 0) {
      throw new Error('conflicts');
    }
  }

  /**
   * Reset start_date và end_date cho campaign schedule về null
   * Dùng khi chuyển SCHEDULED → DRAFT
   * @param campaignId - ID campaign
   */
  private async resetCampaignScheduleDates(campaignId: string): Promise<void> {

    await this.updateCampaignScheduleDates(campaignId, null, null);
    
  }

  /**
   * Cập nhật start_date và end_date cho campaign schedule
   * @param campaignId - ID campaign
   * @param startDate - Ngày bắt đầu
   * @param endDate - Ngày kết thúc
   */
  private async updateCampaignScheduleDates(
    campaignId: string,
    startDate: Date | null,
    endDate: Date | null,
  ): Promise<void> {
    const existingSchedule = await this.campaignScheduleRepository.findOne({
      where: { campaign: { id: campaignId } },
      relations: ['campaign'],
    });

    if (existingSchedule) {
      await this.campaignScheduleRepository
        .createQueryBuilder()
        .update()
        .set({
          start_date: startDate ? startDate.toISOString() : () => 'NULL',
          end_date: endDate ? endDate.toISOString() : () => 'NULL',
        })
        .where('campaign_id = :campaignId', { campaignId })
        .execute();

      // Verify the update
      const verifySchedule = await this.campaignScheduleRepository.findOne({
        where: { campaign: { id: campaignId } },
      });
    }
  }

  /**
   * Debug method để kiểm tra campaign schedule info
   */
  async debugCampaignSchedule(campaignId: string, user: User): Promise<any> {
    const campaign = await this.checkCampaignAccess(campaignId, user);
    // 2. Get department schedule
    const departmentSchedule = await this.getDepartmentActiveSchedule(
      campaign.department.id,
      campaign.campaign_type,
    );

    let scheduleInfo: any = null;
    if (departmentSchedule) {
      scheduleInfo = {
        id: departmentSchedule.id,
        name: departmentSchedule.name,
        type: departmentSchedule.schedule_type,
        status: departmentSchedule.status,
        config: departmentSchedule.schedule_config,
      };
    }

    // 3. Get campaign schedule
    const campaignSchedule = await this.campaignScheduleRepository.findOne({
      where: { campaign: { id: campaignId } },
      relations: ['campaign'],
    });

    let campaignScheduleInfo: any = null;
    if (campaignSchedule) {
      campaignScheduleInfo = {
        id: campaignSchedule.id,
        start_date: campaignSchedule.start_date,
        end_date: campaignSchedule.end_date,
        is_active: campaignSchedule.is_active,
        schedule_config: campaignSchedule.schedule_config,
      };
    }

    // 4. Calculate what the dates should be
    let calculatedDates: any = null;
    if (departmentSchedule) {
      try {
        if (departmentSchedule.schedule_type === ScheduleType.DAILY_DATES) {
          calculatedDates =
            ScheduleCalculatorHelper.calculateDateRangeFromDailyDates(
              departmentSchedule.schedule_config as any,
            );
        } else {
          calculatedDates =
            ScheduleCalculatorHelper.calculateDateRangeFromHourlySlots(
              departmentSchedule.schedule_config as any,
            );
        }
        calculatedDates = {
          startDate: calculatedDates.startDate.toISOString(),
          endDate: calculatedDates.endDate.toISOString(),
        };
      } catch (error) {
        calculatedDates = { error: error.message };
      }
    }

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        type: campaign.campaign_type,
        status: campaign.status,
        department: {
          id: campaign.department?.id,
          name: campaign.department?.name,
        },
      },
      departmentSchedule: scheduleInfo,
      campaignSchedule: campaignScheduleInfo,
      calculatedDates: calculatedDates,
      currentTime: new Date().toISOString(),
      requiredScheduleType:
        ScheduleCalculatorHelper.getScheduleTypeByCampaignType(
          campaign.campaign_type,
        ),
    };
  }

  private async checkCampaignAccess(
    campaignId: string,
    user: User,
  ): Promise<Campaign> {
    const roleNames = (user?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );
    const isAdmin = roleNames.includes('admin');
    const isManager = roleNames.includes('manager-chien-dich');

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      .where('campaign.id = :id', { id: campaignId });

    if (isAdmin) {
      // Admin: có thể truy cập tất cả campaign
    } else if (isManager) {
      // Manager: chỉ truy cập campaign của phòng ban có server_ip
      const userDepartment = user.departments?.find(
        (dept: any) =>
          dept.server_ip !== null &&
          dept.server_ip !== undefined &&
          String(dept.server_ip).trim() !== '',
      );

      if (userDepartment) {
        qb.andWhere('campaign.department.id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        // Manager không có department với server_ip thì không truy cập được gì
        qb.andWhere('1 = 0');
      }
    } else {
      // User thường: chỉ truy cập campaign do chính họ tạo
      qb.andWhere('campaign.created_by.id = :userId', {
        userId: user.id,
      });
    }

    const campaign = await qb.getOne();
    if (!campaign) {
      throw new NotFoundException(
        'Không tìm thấy chiến dịch hoặc bạn không có quyền truy cập',
      );
    }

    return campaign;
  }

  async findAll(query: any = {}, user: User): Promise<CampaignResponse> {
    const roleNames = (user?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );

    const isAdmin = roleNames.includes('admin');
    const isManager = roleNames.includes('manager-chien-dich');

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      .leftJoin(
        'campaign_contents',
        'content',
        'content.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_schedules',
        'schedule',
        'schedule.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_email_reports',
        'email_report',
        'email_report.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_customer_map',
        'customer_map',
        'customer_map.campaign_id = campaign.id',
      )
      .addSelect('content.messages', 'content_messages')
      .addSelect('schedule.schedule_config', 'schedule_config')
      .addSelect('schedule.start_date', 'schedule_start_date')
      .addSelect('schedule.end_date', 'schedule_end_date')
      .addSelect('email_report.recipient_to', 'email_recipient_to')
      .addSelect('email_report.recipients_cc', 'email_recipients_cc')
      .addSelect(
        'email_report.report_interval_minutes',
        'email_report_interval_minutes',
      )
      .addSelect(
        'email_report.stop_sending_at_time',
        'email_stop_sending_at_time',
      )
      .addSelect('email_report.is_active', 'email_is_active')
      .addSelect(
        'email_report.send_when_campaign_completed',
        'email_send_when_campaign_completed',
      )
      .addSelect('COUNT(DISTINCT customer_map.customer_id)', 'customer_count')
      .groupBy('campaign.id, created_by.id, department.id')
      // ✅ THÊM: Loại trừ campaign có status = "archived"
      .where('campaign.status != :archivedStatus', {
        archivedStatus: 'archived',
      });

    // Apply user-based filtering first
    if (isAdmin) {
    } else if (isManager) {
      const userDepartment = user.departments?.find(
        (dept: any) =>
          dept.server_ip !== null &&
          dept.server_ip !== undefined &&
          String(dept.server_ip).trim() !== '',
      );

      if (userDepartment) {
        qb.andWhere('campaign.department_id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        qb.andWhere('1 = 0');
      }
    } else {
      qb.andWhere('campaign.created_by_id = :userId', {
        userId: user.id,
      });
    }

    // Apply search filter
    if (query.search && query.search.trim()) {
      qb.andWhere('campaign.name LIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }

    // Apply campaign types filter - Handle both string and array
    if (query.campaign_types) {
      const typeInput = Array.isArray(query.campaign_types)
        ? query.campaign_types
        : [query.campaign_types];
      const validTypes = typeInput.filter((t) => t && String(t).trim());

      if (validTypes.length > 0) {
        qb.andWhere('campaign.campaign_type IN (:...campaignTypes)', {
          campaignTypes: validTypes,
        });
      }
    }

    // Apply statuses filter - Handle both string and array
    if (query.statuses) {
      const statusInput = Array.isArray(query.statuses)
        ? query.statuses
        : [query.statuses];
      const validStatuses = statusInput.filter((s) => s && String(s).trim());

      if (validStatuses.length > 0) {
        qb.andWhere('campaign.status IN (:...statuses)', {
          statuses: validStatuses,
        });
      }
    }

    // Apply single date filter
    if (query.singleDate) {
      const date = new Date(query.singleDate);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      qb.andWhere('campaign.created_at BETWEEN :startDate AND :endDate', {
        startDate: startOfDay,
        endDate: endOfDay,
      });
    }

    // Apply employee filter - Handle both string and array
    if (query.employees) {
      if (isAdmin || isManager) {
        const employeeInput = Array.isArray(query.employees)
          ? query.employees
          : [query.employees];
        const employeeIds = employeeInput
          .map((id) => parseInt(String(id), 10))
          .filter((id) => !isNaN(id));

        if (employeeIds.length > 0) {
          qb.andWhere('campaign.created_by_id IN (:...employees)', {
            employees: employeeIds,
          });
        }
      }
    }

    if (query.departments && isAdmin) {
      const departmentInput = Array.isArray(query.departments)
        ? query.departments
        : [query.departments];

      const departmentIds = departmentInput
        .map((id) => parseInt(String(id), 10))
        .filter((id) => !isNaN(id));

      if (departmentIds.length > 0) {
        qb.andWhere('department.id IN (:...departments)', {
          departments: departmentIds,
        });
      }
    }

    // Pagination
    const page = Math.max(1, parseInt(query.page) || 1);
    const pageSize = Math.max(1, parseInt(query.pageSize) || 10);
    const skip = (page - 1) * pageSize;

    qb.skip(skip).take(pageSize);
    qb.orderBy('campaign.created_at', 'DESC');

    // THÊM DEBUG: In ra SQL query
    const sql = qb.getQuery();
    const parameters = qb.getParameters();

    const rawResults = await qb.getRawMany();

    // ✅ SỬA: Count query with same fixes
    const countQb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoin('campaign.department', 'department')
      .leftJoin('campaign.created_by', 'created_by')
      // ✅ THÊM: Loại trừ campaign có status = "archived" cho count query
      .where('campaign.status != :archivedStatus', {
        archivedStatus: 'archived',
      });

    // Apply same user-based filtering for count
    if (isAdmin) {
      // Admin: lấy tất cả
    } else if (isManager) {
      const userDepartment = user.departments?.find(
        (dept: any) => dept.server_ip && dept.server_ip.trim() !== '',
      );

      if (userDepartment) {
        countQb.andWhere('campaign.department_id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        countQb.andWhere('1 = 0');
      }
    } else {
      countQb.andWhere('campaign.created_by_id = :userId', {
        userId: user.id,
      });
    }

    // Apply same filters for count
    if (query.search && query.search.trim()) {
      countQb.andWhere('campaign.name LIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }

    // Campaign types filter for count - Handle string/array
    if (query.campaign_types) {
      const typeInput = Array.isArray(query.campaign_types)
        ? query.campaign_types
        : [query.campaign_types];
      const validTypes = typeInput.filter((t) => t && String(t).trim());

      if (validTypes.length > 0) {
        countQb.andWhere('campaign.campaign_type IN (:...campaignTypes)', {
          campaignTypes: validTypes,
        });
      }
    }

    // Status filter for count - Handle string/array
    if (query.statuses) {
      const statusInput = Array.isArray(query.statuses)
        ? query.statuses
        : [query.statuses];
      const validStatuses = statusInput.filter((s) => s && String(s).trim());

      if (validStatuses.length > 0) {
        countQb.andWhere('campaign.status IN (:...statuses)', {
          statuses: validStatuses,
        });
      }
    }

    if (query.singleDate) {
      const date = new Date(query.singleDate);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      countQb.andWhere('campaign.created_at BETWEEN :startDate AND :endDate', {
        startDate: startOfDay,
        endDate: endOfDay,
      });
    }

    if (query.departments && isAdmin) {
      const departmentInput = Array.isArray(query.departments)
        ? query.departments
        : [query.departments];

      const departmentIds = departmentInput
        .map((id) => parseInt(String(id), 10))
        .filter((id) => !isNaN(id));

      if (departmentIds.length > 0) {
        countQb.andWhere('department.id IN (:...departments)', {
          departments: departmentIds,
        });
      }
    }

    // Employee filter for count - Handle string/array
    if (query.employees) {
      if (isAdmin || isManager) {
        const employeeInput = Array.isArray(query.employees)
          ? query.employees
          : [query.employees];
        const employeeIds = employeeInput
          .map((id) => parseInt(String(id), 10))
          .filter((id) => !isNaN(id));

        if (employeeIds.length > 0) {
          countQb.andWhere('campaign.created_by_id IN (:...employees)', {
            employees: employeeIds,
          });
        }
      }
    }

    const total = await countQb.getCount();

    // Rest of the method remains the same...
    const campaignIds = rawResults.map((result) => result.campaign_id);

    const allCustomerMaps =
      campaignIds.length > 0
        ? await this.campaignCustomerMapRepository
            .createQueryBuilder('map')
            .leftJoinAndSelect('map.campaign_customer', 'customer')
            .where('map.campaign_id IN (:...campaignIds)', { campaignIds })
            .getMany()
        : [];

    const customersByCampaign = allCustomerMaps.reduce(
      (acc, map) => {
        if (!acc[map.campaign_id]) acc[map.campaign_id] = [];
        acc[map.campaign_id].push({
          phone_number: map.campaign_customer.phone_number,
          full_name: map.full_name,
          salutation: map.salutation,
        });
        return acc;
      },
      {} as Record<
        string,
        Array<{
          phone_number: string;
          full_name: string;
          salutation?: string;
        }>
      >,
    );

    const data: CampaignWithDetails[] = rawResults.map((result: any) => {
      const messages = result.content_messages || [];
      const initialMessage = Array.isArray(messages)
        ? messages.find((msg) => msg.type === 'initial') || messages[0]
        : null;

      const reminderMessages = Array.isArray(messages)
        ? messages.filter((msg) => msg.type === 'reminder')
        : [];

      const scheduleConfig = result.schedule_config || {};

      let start_date: string | undefined = undefined;
      let end_date: string | undefined = undefined;

      if (result.schedule_start_date) {
        start_date =
          result.schedule_start_date instanceof Date
            ? result.schedule_start_date.toISOString()
            : result.schedule_start_date;
      }

      if (result.schedule_end_date) {
        end_date =
          result.schedule_end_date instanceof Date
            ? result.schedule_end_date.toISOString()
            : result.schedule_end_date;
      }

      return {
        id: result.campaign_id,
        name: result.campaign_name,
        campaign_type: result.campaign_campaign_type,
        status: result.campaign_status,
        send_method: result.campaign_send_method,
        created_at: result.campaign_created_at,
        updated_at: result.campaign_updated_at,
        department: {
          id: result.department_id,
          name: result.department_name,
          slug: result.department_slug,
          server_ip: result.department_server_ip,
          createdAt: result.department_createdAt,
          updatedAt: result.department_updatedAt,
          deletedAt: result.department_deletedAt,
        },
        created_by: {
          id: result.created_by_id,
          username: result.created_by_username,
          fullName: result.created_by_fullName,
          email: result.created_by_email,
          isBlock: result.created_by_isBlock,
          employeeCode: result.created_by_employeeCode,
          status: result.created_by_status,
          lastLogin: result.created_by_lastLogin,
          nickName: result.created_by_nickName,
          deletedAt: result.created_by_deletedAt,
          createdAt: result.created_by_createdAt,
          updatedAt: result.created_by_updatedAt,
          zaloLinkStatus: result.created_by_zaloLinkStatus,
          zaloName: result.created_by_zaloName,
          avatarZalo: result.created_by_avatarZalo,
          zaloGender: result.created_by_zaloGender,
          lastOnlineAt: result.created_by_lastOnlineAt,
        } as any,
        customer_count: customersByCampaign[result.campaign_id]?.length || 0,
        messages: {
          type: 'initial' as const,
          text: initialMessage?.text || '',
          attachment: initialMessage?.attachment || null,
        },
        schedule_config: {
          type: scheduleConfig.type || 'hourly',
          start_time: scheduleConfig.start_time,
          end_time: scheduleConfig.end_time,
          remind_after_minutes: scheduleConfig.remind_after_minutes,
          days_of_week: scheduleConfig.days_of_week,
          day_of_week: scheduleConfig.day_of_week,
          time_of_day: scheduleConfig.time_of_day,
        },
        reminders: reminderMessages.map((reminder: any) => ({
          content: reminder.text,
          minutes: reminder.offset_minutes,
        })),
        email_reports: result.email_recipient_to
          ? {
              recipients_to: result.email_recipient_to,
              recipients_cc: result.email_recipients_cc,
              report_interval_minutes: result.email_report_interval_minutes,
              stop_sending_at_time: result.email_stop_sending_at_time,
              is_active: result.email_is_active,
              send_when_campaign_completed:
                result.email_send_when_campaign_completed,
            }
          : undefined,
        customers: customersByCampaign[result.campaign_id] || [],
        start_date,
        end_date,
      } as CampaignWithDetails;
    });

    const stats = await this.getStats(user);
    return { data, total, stats };
  }

  async findOne(id: string, user: User): Promise<CampaignWithDetails> {
    // Kiểm tra quyền truy cập trước - thay thế logic filter department cũ
    await this.checkCampaignAccess(id, user);

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      // Join với các entity riêng biệt để lấy full data
      .leftJoin(
        'campaign_contents',
        'content',
        'content.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_schedules',
        'schedule',
        'schedule.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_email_reports',
        'email_report',
        'email_report.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_customer_map',
        'customer_map',
        'customer_map.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_customers',
        'customer',
        'customer.id = customer_map.customer_id',
      )
      .addSelect('content.messages', 'content_messages')
      .addSelect('schedule.schedule_config', 'schedule_config')
      .addSelect('schedule.start_date', 'schedule_start_date')
      .addSelect('schedule.end_date', 'schedule_end_date')
      .addSelect('email_report.recipient_to', 'email_recipient_to')
      .addSelect('email_report.recipients_cc', 'email_recipients_cc')
      .addSelect(
        'email_report.report_interval_minutes',
        'email_report_interval_minutes',
      )
      .addSelect(
        'email_report.stop_sending_at_time',
        'email_stop_sending_at_time',
      )
      .addSelect('email_report.is_active', 'email_is_active')
      .addSelect(
        'email_report.send_when_campaign_completed',
        'email_send_when_campaign_completed',
      )
      .addSelect('COUNT(customer_map.customer_id)', 'customer_count')
      .where('campaign.id = :id', { id })
      .groupBy(
        'campaign.id, created_by.id, department.id, content.id, schedule.id, email_report.id',
      );

    const rawResult = await qb.getRawOne();

    if (!rawResult) {
      throw new NotFoundException('Không tìm thấy chiến dịch');
    }

    // Parse messages để lấy initial message và reminders
    const messages = rawResult.content_messages || [];
    const initialMessage = Array.isArray(messages)
      ? messages.find((msg) => msg.type === 'initial') || messages[0]
      : null;
    const reminderMessages = Array.isArray(messages)
      ? messages.filter((msg) => msg.type === 'reminder')
      : [];

    // Parse schedule config
    const scheduleConfig = rawResult.schedule_config || {};

    // Parse start_date và end_date từ rawResult
    let start_date: string | undefined = undefined;
    let end_date: string | undefined = undefined;
    if (rawResult.schedule_start_date) {
      start_date =
        rawResult.schedule_start_date instanceof Date
          ? rawResult.schedule_start_date.toISOString()
          : rawResult.schedule_start_date;
    }
    if (rawResult.schedule_end_date) {
      end_date =
        rawResult.schedule_end_date instanceof Date
          ? rawResult.schedule_end_date.toISOString()
          : rawResult.schedule_end_date;
    }

    // Get customers for this campaign
    const customers = await this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoinAndSelect('map.campaign_customer', 'customer')
      .where('map.campaign_id = :campaignId', { campaignId: id })
      .getMany();

    const campaignWithDetails: CampaignWithDetails = {
      id: rawResult.campaign_id,
      name: rawResult.campaign_name,
      campaign_type: rawResult.campaign_campaign_type,
      status: rawResult.campaign_status,
      send_method: rawResult.campaign_send_method,
      created_at: rawResult.campaign_created_at,
      updated_at: rawResult.campaign_updated_at,
      deleted_at: rawResult.campaign_deleted_at || null,
      department: {
        id: rawResult.department_id,
        name: rawResult.department_name,
        slug: rawResult.department_slug,
        server_ip: rawResult.department_server_ip,
        createdAt: rawResult.department_createdAt,
        updatedAt: rawResult.department_updatedAt,
        deletedAt: rawResult.department_deletedAt,
      },
      created_by: {
        id: rawResult.created_by_id,
        username: rawResult.created_by_username,
        fullName: rawResult.created_by_fullName,
        email: rawResult.created_by_email,
        isBlock: rawResult.created_by_isBlock,
        employeeCode: rawResult.created_by_employeeCode,
        status: rawResult.created_by_status,
        lastLogin: rawResult.created_by_lastLogin,
        nickName: rawResult.created_by_nickName,
        deletedAt: rawResult.created_by_deletedAt,
        createdAt: rawResult.created_by_createdAt,
        updatedAt: rawResult.created_by_updatedAt,
        zaloLinkStatus: rawResult.created_by_zaloLinkStatus,
        zaloName: rawResult.created_by_zaloName,
        avatarZalo: rawResult.created_by_avatarZalo,
        zaloGender: rawResult.created_by_zaloGender,
        lastOnlineAt: rawResult.created_by_lastOnlineAt,
      } as any,
      customer_count: customers.length,
      messages: {
        type: 'initial' as const,
        text: initialMessage?.text || '',
        attachment: initialMessage?.attachment || null,
      },
      schedule_config: {
        type: scheduleConfig.type || 'hourly',
        start_time: scheduleConfig.start_time,
        end_time: scheduleConfig.end_time,
        remind_after_minutes: scheduleConfig.remind_after_minutes,
        days_of_week: scheduleConfig.days_of_week,
        day_of_week: scheduleConfig.day_of_week,
        time_of_day: scheduleConfig.time_of_day,
      },
      reminders: reminderMessages.map((reminder: any) => ({
        content: reminder.text,
        minutes: reminder.offset_minutes,
      })),
      email_reports: rawResult.email_recipient_to
        ? {
            recipients_to: rawResult.email_recipient_to,
            recipients_cc: rawResult.email_recipients_cc,
            report_interval_minutes: rawResult.email_report_interval_minutes,
            stop_sending_at_time: rawResult.email_stop_sending_at_time,
            is_active: rawResult.email_is_active,
            send_when_campaign_completed:
              rawResult.email_send_when_campaign_completed,
          }
        : undefined,
      customers: customers.map((map) => ({
        phone_number: map.campaign_customer.phone_number,
        full_name: map.full_name,
        salutation: map.salutation,
      })),
      start_date,
      end_date,
    };

    return campaignWithDetails;
  }

  async create(data: any, user: User): Promise<CampaignWithDetails> {
    const queryRunner =
      this.campaignRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Lấy department
      let department: Department | undefined;
      if (data.department_id) {
        const foundDepartment = await queryRunner.manager.findOne(Department, {
          where: { id: Number(data.department_id) },
        });
        department = foundDepartment === null ? undefined : foundDepartment;
        if (!department) {
          throw new BadRequestException('Phòng ban không tồn tại');
        }
      } else {
        // Lấy phòng ban đầu tiên của user có server_ip khác NULL
        department = user.departments?.find(
          (dept: Department) => !!dept.server_ip,
        );
        if (!department) {
          throw new BadRequestException(
            'Người dùng phải thuộc về một phòng ban có server_ip',
          );
        }
      }

      // 2. Lấy created_by
      let createdBy: User;
      if (data.created_by) {
        const foundUser = await queryRunner.manager.findOne(User, {
          where: { id: Number(data.created_by) },
        });
        if (!foundUser) {
          throw new BadRequestException('Người tạo không tồn tại');
        }
        createdBy = foundUser;
      } else {
        createdBy = user;
      }

      // 3. Tạo campaign chính
      const campaign = queryRunner.manager.create(Campaign, {
        name: data.name,
        campaign_type: data.campaign_type,
        status: data.status || CampaignStatus.DRAFT,
        send_method: data.send_method,
        department: department,
        created_by: createdBy,
      });

      const savedCampaign = await queryRunner.manager.save(Campaign, campaign);

      // 4. Tạo campaign content (messages)
      if (data.messages) {
        let messages: PromoMessageFlow;

        // Thêm reminders vào messages
        if (data.reminders && Array.isArray(data.reminders)) {
          const reminderMessages: ReminderMessage[] = data.reminders.map(
            (reminder: any) => ({
              type: 'reminder' as const,
              offset_minutes: reminder.minutes,
              text: reminder.content,
              attachment: null,
            }),
          );
          messages = [data.messages, ...reminderMessages] as PromoMessageFlow;
        } else {
          messages = [data.messages] as PromoMessageFlow;
        }

        const campaignContent = queryRunner.manager.create(CampaignContent, {
          campaign: savedCampaign,
          messages: messages,
        });

        await queryRunner.manager.save(CampaignContent, campaignContent);
      }

      // 5. Tạo campaign schedule
      if (data.schedule_config) {
        const campaignSchedule = queryRunner.manager.create(CampaignSchedule, {
          campaign: savedCampaign,
          schedule_config: data.schedule_config,
          is_active: true,
        });

        await queryRunner.manager.save(CampaignSchedule, campaignSchedule);
      }

      // 6. Tạo email reports
      if (data.email_reports) {
        const campaignEmailReport = queryRunner.manager.create(
          CampaignEmailReport,
          {
            campaign: savedCampaign,
            recipient_to: data.email_reports.recipients_to,
            recipients_cc: data.email_reports.recipients_cc,
            report_interval_minutes: data.email_reports.report_interval_minutes,
            stop_sending_at_time: data.email_reports.stop_sending_at_time,
            is_active: data.email_reports.is_active,
            send_when_campaign_completed:
              data.email_reports.send_when_campaign_completed,
          },
        );

        await queryRunner.manager.save(
          CampaignEmailReport,
          campaignEmailReport,
        );
      }

      // 7. Tạo customers và mapping
      if (data.customers && Array.isArray(data.customers)) {
        for (const customerData of data.customers) {
          // Kiểm tra customer đã tồn tại chưa
          let customer = await queryRunner.manager.findOne(CampaignCustomer, {
            where: { phone_number: customerData.phone_number },
          });

          // Nếu chưa tồn tại thì tạo mới
          if (!customer) {
            customer = queryRunner.manager.create(CampaignCustomer, {
              phone_number: customerData.phone_number,
              // Bỏ full_name và salutation ở đây
            });
            customer = await queryRunner.manager.save(
              CampaignCustomer,
              customer,
            );
          }

          // Tạo mapping với full_name và salutation
          const customerMap = queryRunner.manager.create(CampaignCustomerMap, {
            campaign_id: Number(savedCampaign.id),
            customer_id: Number(customer.id),
            full_name: customerData.full_name, // Lưu vào map
            salutation: customerData.salutation, // Lưu vào map
            campaign: savedCampaign,
            campaign_customer: customer,
          });
          await queryRunner.manager.save(CampaignCustomerMap, customerMap);
        }
      }

      await queryRunner.commitTransaction();

      // Trả về campaign với đầy đủ thông tin
      return await this.findOne(savedCampaign.id, user);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async update(
    id: string,
    data: any,
    user: User,
  ): Promise<CampaignWithDetails> {
    const queryRunner =
      this.campaignRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Kiểm tra quyền truy cập trước khi update
      const campaign = await this.checkCampaignAccess(id, user);

      // ✅ 2. KIỂM TRA TRẠNG THÁI - CHỈ CHO PHÉP SỬA DRAFT VÀ PAUSED
      if (
        ![CampaignStatus.DRAFT, CampaignStatus.PAUSED].includes(campaign.status)
      ) {
        throw new BadRequestException(
          `Không thể chỉnh sửa chiến dịch ở trạng thái ${campaign.status}. Chỉ có thể sửa chiến dịch ở trạng thái bản nháp hoặc tạm dừng.`,
        );
      }

      // 3. Lấy campaign hiện tại (đã được verify quyền)
      const existingCampaign = await this.findOne(id, user);

      // 4. Cập nhật campaign chính
      const updatedCampaign = await queryRunner.manager.save(Campaign, {
        ...existingCampaign,
        name: data.name || existingCampaign.name,
        campaign_type: data.campaign_type || existingCampaign.campaign_type,
        status: data.status || existingCampaign.status,
        send_method: data.send_method || existingCampaign.send_method,
      });

      // 5. Cập nhật campaign content (messages)
      if (data.messages) {
        // Xóa content cũ
        await queryRunner.manager.delete(CampaignContent, { campaign: { id } });

        let messages: PromoMessageFlow;

        // Thêm reminders vào messages
        if (data.reminders && Array.isArray(data.reminders)) {
          const reminderMessages: ReminderMessage[] = data.reminders.map(
            (reminder: any) => ({
              type: 'reminder' as const,
              offset_minutes: reminder.minutes,
              text: reminder.content,
              attachment: null,
            }),
          );

          messages = [data.messages, ...reminderMessages] as PromoMessageFlow;
        } else {
          messages = [data.messages] as PromoMessageFlow;
        }

        const campaignContent = queryRunner.manager.create(CampaignContent, {
          campaign: updatedCampaign,
          messages: messages,
        });

        await queryRunner.manager.save(CampaignContent, campaignContent);
      }

      // 6. Cập nhật campaign schedule
      if (data.schedule_config) {
        // Xóa schedule cũ
        await queryRunner.manager.delete(CampaignSchedule, {
          campaign: { id },
        });

        const campaignSchedule = queryRunner.manager.create(CampaignSchedule, {
          campaign: updatedCampaign,
          schedule_config: data.schedule_config,
          is_active: true,
        });

        await queryRunner.manager.save(CampaignSchedule, campaignSchedule);
      }

      // 7. ✅ Cập nhật email reports - BẢO TOÀN is_active và last_sent_at
      if (data.email_reports) {
        // Tìm email report hiện tại trước khi xóa/tạo mới
        const existingEmailReport = await queryRunner.manager.findOne(
          CampaignEmailReport,
          {
            where: { campaign: { id: String(id) } },
            select: {
              id: true,
              is_active: true,
              last_sent_at: true,
            },
          },
        );

        if (existingEmailReport) {
          // ✅ Nếu đã tồn tại, chỉ update các field cho phép
          await queryRunner.manager.update(
            CampaignEmailReport,
            existingEmailReport.id,
            {
              recipient_to: data.email_reports.recipients_to,
              recipients_cc: data.email_reports.recipients_cc,
              report_interval_minutes:
                data.email_reports.report_interval_minutes,
              stop_sending_at_time: data.email_reports.stop_sending_at_time,
              send_when_campaign_completed:
                data.email_reports.send_when_campaign_completed,
              // ✅ KHÔNG update is_active và last_sent_at - bảo toàn giá trị cũ
              // updated_at sẽ tự động update do @UpdateDateColumn
            },
          );
        } else {
          // ✅ Nếu chưa tồn tại, tạo mới với giá trị từ data
          const campaignEmailReport = queryRunner.manager.create(
            CampaignEmailReport,
            {
              campaign: updatedCampaign,
              recipient_to: data.email_reports.recipients_to,
              recipients_cc: data.email_reports.recipients_cc,
              report_interval_minutes:
                data.email_reports.report_interval_minutes,
              stop_sending_at_time: data.email_reports.stop_sending_at_time,
              is_active: data.email_reports.is_active ?? true, // Giá trị mặc định cho record mới
              send_when_campaign_completed:
                data.email_reports.send_when_campaign_completed,
              // last_sent_at sẽ là undefined theo entity definition
            },
          );

          await queryRunner.manager.save(
            CampaignEmailReport,
            campaignEmailReport,
          );
        }
      }

      // 8. Cập nhật customers và mapping
      if (data.customers && Array.isArray(data.customers)) {
        // Xóa mappings cũ
        await queryRunner.manager.delete(CampaignCustomerMap, {
          campaign: { id },
        });

        for (const customerData of data.customers) {
          let customer = await queryRunner.manager.findOne(CampaignCustomer, {
            where: { phone_number: customerData.phone_number },
          });

          if (!customer) {
            customer = queryRunner.manager.create(CampaignCustomer, {
              phone_number: customerData.phone_number,
              // Bỏ full_name và salutation
            });
            customer = await queryRunner.manager.save(
              CampaignCustomer,
              customer,
            );
          }

          // Tạo mapping mới với full_name và salutation
          const customerMap = queryRunner.manager.create(CampaignCustomerMap, {
            campaign_id: Number(id),
            customer_id: Number(customer.id),
            full_name: customerData.full_name,
            salutation: customerData.salutation,
            campaign: updatedCampaign,
            campaign_customer: customer,
          });
          await queryRunner.manager.save(CampaignCustomerMap, customerMap);
        }
      }

      await queryRunner.commitTransaction();

      // Trả về campaign đã được cập nhật
      return await this.findOne(id, user);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async updateStatus(
    id: string,
    status: CampaignStatus,
    user: User,
  ): Promise<{ success: boolean; error?: string; data?: CampaignWithDetails }> {
    this.logger.log(
      `🔄 [updateStatus] Starting status update for campaign ${id}: ${status}`,
    );
    this.logger.log(
      `🔄 [updateStatus] User: ${user.username}, Department IDs: ${user.departments?.map((d) => d.id).join(',')}`,
    );

    try {
      // Kiểm tra quyền truy cập và lấy campaign
      const campaign = await this.checkCampaignAccess(id, user);
      this.logger.log(
        `✅ [updateStatus] Campaign found: ${campaign.name}, Type: ${campaign.campaign_type}, Current Status: ${campaign.status}`,
      );
      this.logger.log(
        `✅ [updateStatus] Campaign Department: ${campaign.department?.name} (ID: ${campaign.department?.id})`,
      );

      // Validate status transitions
      this.validateStatusTransition(campaign.status, status);
      this.logger.log(
        `✅ [updateStatus] Status transition validated: ${campaign.status} → ${status}`,
      );

      // ✨ THÊM LOGIC SCHEDULE
      if (
        campaign.status === CampaignStatus.DRAFT &&
        status === CampaignStatus.SCHEDULED
      ) {
        this.logger.log(
          `🚀 [updateStatus] Triggering schedule setup for DRAFT → SCHEDULED`,
        );
        await this.setupCampaignScheduleDates(campaign);
        this.logger.log(
          `✅ [updateStatus] Schedule setup completed successfully`,
        );
      } else if (
        campaign.status === CampaignStatus.SCHEDULED &&
        status === CampaignStatus.RUNNING
      ) {
        this.logger.log(
          `🚀 [updateStatus] Triggering schedule validation for SCHEDULED → RUNNING`,
        );
        await this.validateCurrentTimeInSchedule(campaign);
        this.logger.log(
          `✅ [updateStatus] Schedule validation completed successfully`,
        );
      } else if (
        campaign.status === CampaignStatus.SCHEDULED &&
        status === CampaignStatus.DRAFT
      ) {
        this.logger.log(
          `🚀 [updateStatus] Triggering schedule reset for SCHEDULED → DRAFT`,
        );
        await this.resetCampaignScheduleDates(campaign.id);
        this.logger.log(
          `✅ [updateStatus] Schedule reset completed successfully`,
        );
      } else {
        this.logger.log(
          `ℹ️ [updateStatus] Skipping schedule operations for ${campaign.status} → ${status}`,
        );
      }

      // Update campaign status
      await this.campaignRepository.update(id, { status });
      this.logger.log(`✅ [updateStatus] Campaign status updated to ${status}`);

      // Return updated campaign with full details
      const result = await this.findOne(id, user);
      this.logger.log(`✅ [updateStatus] Returning updated campaign details`);

      return { success: true, data: result };
    } catch (error) {
      this.logger.error(
        `❌ [updateStatus] Error: ${error.message}`,
        error.stack,
      );

      // Trả về error ngắn gọn cho frontend
      let errorMessage = 'Không thể cập nhật trạng thái chiến dịch';

      if (error.message.includes('không nằm trong quy định')) {
        errorMessage =
          'Thời gian hoạt động không nằm trong quy định lịch hoạt động của phòng ban';
      } else if (error.message.includes('chưa có lịch hoạt động')) {
        errorMessage = 'Phòng ban chưa có lịch hoạt động phù hợp';
      } else if (error.message.includes('không trong khung thời gian')) {
        errorMessage = 'Hiện tại không trong khung thời gian được phép';
      } else if (error.message.includes('conflicts')) {
        errorMessage = 'Có chiến dịch khác đang chạy cùng thời gian';
      } else if (error.message.includes('Trạng thái không hợp lệ')) {
        errorMessage = 'Không thể chuyển trạng thái này';
      }

      return { success: false, error: errorMessage };
    }
  }

  async delete(id: string, user: User): Promise<void> {
    // Kiểm tra quyền truy cập
    const campaign = await this.checkCampaignAccess(id, user);

    // ✅ CHỈ CHO PHÉP XÓA CAMPAIGN Ở TRẠNG THÁI DRAFT
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException(
        `Không thể xóa chiến dịch ở trạng thái ${campaign.status}. Chỉ có thể xóa chiến dịch ở trạng thái bản nháp.`,
      );
    }

    // Xóa mềm (soft delete)
    await this.campaignRepository.softRemove(campaign);
  }

  async archive(
    id: string,
    user: User,
  ): Promise<{ success: boolean; error?: string; data?: CampaignWithDetails }> {
    // Kiểm tra quyền truy cập trước khi archive
    const campaign = await this.checkCampaignAccess(id, user);

    // ✅ CHỈ CHO PHÉP ARCHIVE CAMPAIGN Ở TRẠNG THÁI COMPLETED
    if (campaign.status !== CampaignStatus.COMPLETED) {
      return {
        success: false,
        error: 'Chỉ có thể lưu trữ chiến dịch đã hoàn thành',
      };
    }

    return this.updateStatus(id, CampaignStatus.ARCHIVED, user);
  }

  private validateStatusTransition(
    currentStatus: CampaignStatus,
    newStatus: CampaignStatus,
  ): void {
    // ✅ LOGIC MỚI - PHÙ HỢP VỚI BOT PYTHON TỰ ĐỘNG XỬ LÝ
    const validTransitions: Record<CampaignStatus, CampaignStatus[]> = {
      [CampaignStatus.DRAFT]: [CampaignStatus.SCHEDULED], // Chỉ chuyển thành đã lên lịch
      [CampaignStatus.SCHEDULED]: [CampaignStatus.DRAFT], // Chỉ chuyển về bản nháp (không chuyển thành đang chạy)
      [CampaignStatus.RUNNING]: [CampaignStatus.PAUSED], // Chỉ tạm dừng (không chuyển thành hoàn thành - bot Python sẽ làm)
      [CampaignStatus.PAUSED]: [CampaignStatus.RUNNING], // Chỉ chạy lại
      [CampaignStatus.COMPLETED]: [CampaignStatus.ARCHIVED], // Chỉ lưu trữ
      [CampaignStatus.ARCHIVED]: [], // Không thể chuyển từ ARCHIVED
    };

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw new Error('Trạng thái không hợp lệ');
    }
  }

  async getStats(user: User): Promise<any> {
    const roleNames = (user?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );
    const isAdmin = roleNames.includes('admin');
    const isManager = roleNames.includes('manager-chien-dich');

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoin('campaign.department', 'department')
      .leftJoin('campaign.created_by', 'created_by');

    if (isAdmin) {
      // Admin: thống kê tất cả campaign
    } else if (isManager) {
      // Manager: thống kê campaign của phòng ban có server_ip
      const userDepartment = user.departments?.find(
        (dept: any) =>
          dept.server_ip !== null &&
          dept.server_ip !== undefined &&
          String(dept.server_ip).trim() !== '',
      );

      if (userDepartment) {
        qb.andWhere('campaign.department.id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        // Nếu manager không có department với server_ip thì không thống kê gì
        qb.andWhere('1 = 0');
      }
    } else {
      // User thường: chỉ thống kê campaign do chính họ tạo
      qb.andWhere('campaign.created_by.id = :userId', {
        userId: user.id,
      });
    }

    const [
      totalCampaigns,
      draftCampaigns,
      runningCampaigns,
      completedCampaigns,
      archivedCampaigns,
      scheduledCampaigns,
    ] = await Promise.all([
      qb.getCount(),
      qb
        .clone()
        .andWhere('campaign.status = :status', { status: CampaignStatus.DRAFT })
        .getCount(),
      qb
        .clone()
        .andWhere('campaign.status = :status', {
          status: CampaignStatus.RUNNING,
        })
        .getCount(),
      qb
        .clone()
        .andWhere('campaign.status = :status', {
          status: CampaignStatus.COMPLETED,
        })
        .getCount(),
      qb
        .clone()
        .andWhere('campaign.status = :status', {
          status: CampaignStatus.ARCHIVED,
        })
        .getCount(),
      qb
        .clone()
        .andWhere('campaign.status = :status', {
          status: CampaignStatus.SCHEDULED,
        })
        .getCount(),
    ]);

    return {
      totalCampaigns,
      draftCampaigns,
      runningCampaigns,
      completedCampaigns,
      archivedCampaigns,
      scheduledCampaigns,
    };
  }

  async getCampaignCustomers(campaignId: string, query: any = {}, user: User) {
    // Kiểm tra quyền truy cập campaign
    await this.checkCampaignAccess(campaignId, user);

    const qb = this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoin('map.campaign_customer', 'customer')
      .leftJoin('map.campaign', 'campaign')
      .leftJoin(
        'campaign_interaction_logs',
        'log',
        'log.customer_id = customer.id AND log.campaign_id = map.campaign_id',
      )
      .select([
        'map.campaign_id as campaign_id',
        'map.customer_id as customer_id',
        'map.full_name as full_name',
        'map.salutation as salutation',
        'map.added_at as added_at',
        'customer.id as customer_id',
        'customer.phone_number as phone_number',
        'customer.created_at as customer_created_at',
        'customer.updated_at as customer_updated_at',
        'log.status as interaction_status',
        'log.conversation_metadata as conversation_metadata',
        'log.sent_at as sent_at',
      ])
      .where('map.campaign_id = :campaignId', { campaignId });

    // Filter by search
    if (query.search) {
      qb.andWhere(
        '(map.full_name LIKE :search OR customer.phone_number LIKE :search)',
        {
          search: `%${query.search}%`,
        },
      );
    }

    // Filter by status
    if (query.status) {
      qb.andWhere('log.status = :status', {
        status: query.status,
      });
    }

    // Sắp xếp theo sent_at để đảm bảo thứ tự đúng
    qb.orderBy('map.added_at', 'DESC').addOrderBy('log.sent_at', 'ASC');

    // Count query for pagination - đếm số customer unique, không phải số log
    const countQb = this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoin('map.campaign_customer', 'customer')
      .select('COUNT(DISTINCT map.customer_id)', 'count')
      .where('map.campaign_id = :campaignId', { campaignId });

    // Apply same filters to count query
    if (query.search) {
      countQb.andWhere(
        '(map.full_name LIKE :search OR customer.phone_number LIKE :search)',
        {
          search: `%${query.search}%`,
        },
      );
    }

    if (query.status) {
      countQb.leftJoin(
        'campaign_interaction_logs',
        'log',
        'log.customer_id = customer.id AND log.campaign_id = map.campaign_id',
      );
      countQb.andWhere('log.status = :status', {
        status: query.status,
      });
    }

    // Lấy tất cả raw results trước
    const rawResults = await qb.getRawMany();

    // Define interface for grouped data
    interface GroupedCustomer {
      id: string;
      phone_number: string;
      full_name: string;
      salutation: string;
      created_at: Date;
      updated_at: Date;
      added_at: Date;
      logs: Array<{
        status: string;
        conversation_metadata: any;
        sent_at: Date;
      }>;
    }

    // Group theo customer_id và sắp xếp logs theo sent_at
    const groupedData: Record<string, GroupedCustomer> = rawResults.reduce(
      (acc, row) => {
        const customerId = row.customer_id;

        if (!acc[customerId]) {
          acc[customerId] = {
            id: row.customer_id,
            phone_number: row.phone_number,
            full_name: row.full_name,
            salutation: row.salutation,
            created_at: row.customer_created_at,
            updated_at: row.customer_updated_at,
            added_at: row.added_at,
            logs: [],
          };
        }

        // Chỉ thêm log nếu có dữ liệu log
        if (row.sent_at) {
          acc[customerId].logs.push({
            status: row.interaction_status,
            conversation_metadata: row.conversation_metadata,
            sent_at: new Date(row.sent_at),
          });
        }

        return acc;
      },
      {},
    );

    // Convert thành array và tạo một entry cho mỗi log
    const expandedResults: any[] = [];
    Object.values(groupedData).forEach((customer: GroupedCustomer) => {
      if (customer.logs.length > 0) {
        // Sắp xếp logs theo sent_at
        customer.logs.sort((a, b) => a.sent_at.getTime() - b.sent_at.getTime());

        // Tạo một entry cho mỗi log
        customer.logs.forEach((log) => {
          expandedResults.push({
            id: customer.id,
            phone_number: customer.phone_number,
            full_name: customer.full_name,
            salutation: customer.salutation,
            created_at: customer.created_at,
            updated_at: customer.updated_at,
            added_at: customer.added_at,
            status: log.status,
            conversation_metadata: log.conversation_metadata,
            sent_at: log.sent_at,
          });
        });
      } else {
        // Customer không có log
        expandedResults.push({
          id: customer.id,
          phone_number: customer.phone_number,
          full_name: customer.full_name,
          salutation: customer.salutation,
          created_at: customer.created_at,
          updated_at: customer.updated_at,
          added_at: customer.added_at,
          status: null,
          conversation_metadata: null,
          sent_at: null,
        });
      }
    });

    // Pagination trên kết quả đã expand
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const skip = (page - 1) * limit;

    const paginatedResults = expandedResults.slice(skip, skip + limit);

    // Lấy total count
    const countResult = await countQb.getRawOne();
    const total = parseInt(countResult.count) || 0;

    return {
      data: paginatedResults,
      total: expandedResults.length, // Total số entries (bao gồm cả multiple logs)
      page,
      limit,
    };
  }

  async exportCustomers(campaignId: string, query: any = {}, user: User) {
    // Kiểm tra quyền truy cập campaign - thay thế việc gọi findOne
    await this.checkCampaignAccess(campaignId, user);

    const qb = this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoinAndSelect('map.campaign_customer', 'customer')
      .where('map.campaign_id = :campaignId', { campaignId });

    // Apply filters
    if (query.search) {
      qb.andWhere(
        '(customer.full_name LIKE :search OR customer.phone_number LIKE :search)',
        {
          search: `%${query.search}%`,
        },
      );
    }

    if (query.status) {
      qb.leftJoin('customer.logs', 'log').andWhere('log.status = :status', {
        status: query.status,
      });
    }

    qb.orderBy('map.added_at', 'DESC');

    const customers = await qb.getMany();

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Khách hàng');

    // Add headers
    worksheet.columns = [
      { header: 'Số điện thoại', key: 'phone_number', width: 15 },
      { header: 'Họ tên', key: 'full_name', width: 25 },
      { header: 'Xưng hô', key: 'salutation', width: 10 },
      { header: 'Ngày thêm', key: 'added_at', width: 20 },
    ];

    // Add data
    customers.forEach((map) => {
      worksheet.addRow({
        phone_number: map.campaign_customer.phone_number,
        full_name: map.full_name,
        salutation: map.salutation || '',
        added_at: map.added_at.toLocaleDateString('vi-VN'),
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const { Readable } = require('stream');
    return Readable.from(buffer);
  }

  async getCustomerLogs(
    campaignId: string,
    customerId: string,
    user: User,
    sentDate?: string, // Thêm parameter này
  ) {
    // Kiểm tra quyền truy cập campaign
    await this.checkCampaignAccess(campaignId, user);

    let query = this.campaignLogRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.campaign', 'campaign')
      .leftJoinAndSelect('log.customer', 'customer')
      .leftJoinAndSelect('log.staff_handler', 'staff_handler')
      .addSelect('staff_handler.avatar_zalo', 'staff_avatar_zalo')
      .where('log.campaign_id = :campaignId', { campaignId })
      .andWhere('log.customer_id = :customerId', { customerId });

    // 🔥 THÊM ĐIỀU KIỆN SENT_AT
    if (sentDate) {
      // Chuyển sent_date thành range của ngày đó
      const startOfDay = `${sentDate} 00:00:00`;
      const endOfDay = `${sentDate} 23:59:59`;

      query = query
        .andWhere('log.sent_at >= :startOfDay', { startOfDay })
        .andWhere('log.sent_at <= :endOfDay', { endOfDay });
    }

    const rawLogs = await query
      .orderBy('log.sent_at', 'DESC')
      .getRawAndEntities();

    // Map để thêm avatar_zalo vào response
    return rawLogs.entities.map((log, index) => ({
      ...log,
      staff_handler_avatar_zalo: rawLogs.raw[index]?.staff_avatar_zalo || null,
    }));
  }

  async updateCampaignCustomer(
    campaignId: string,
    customerId: string,
    data: CustomerDto,
    user: User,
  ): Promise<{ success: boolean; message: string }> {
    const queryRunner =
      this.campaignRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Kiểm tra quyền truy cập campaign
      const campaign = await this.checkCampaignAccess(campaignId, user);

      // 2. Kiểm tra campaign phải ở trạng thái DRAFT
      if (campaign.status !== CampaignStatus.DRAFT) {
        throw new BadRequestException(
          'Chỉ có thể chỉnh sửa khách hàng trong chiến dịch ở trạng thái bản nháp',
        );
      }

      // 3. Kiểm tra customer mapping tồn tại
      const customerMap = await queryRunner.manager.findOne(
        CampaignCustomerMap,
        {
          where: {
            campaign_id: Number(campaignId),
            customer_id: Number(customerId),
          },
          relations: ['campaign_customer'],
        },
      );

      if (!customerMap) {
        throw new NotFoundException(
          'Không tìm thấy khách hàng trong chiến dịch này',
        );
      }

      // 4. Kiểm tra số điện thoại mới có trùng với customer khác không
      if (data.phone_number !== customerMap.campaign_customer.phone_number) {
        const existingCustomer = await queryRunner.manager.findOne(
          CampaignCustomer,
          {
            where: { phone_number: data.phone_number.trim() },
          },
        );

        if (
          existingCustomer &&
          existingCustomer.id !== customerMap.campaign_customer.id
        ) {
          throw new BadRequestException(
            'Số điện thoại này đã tồn tại trong hệ thống',
          );
        }
      }

      // 5. Cập nhật thông tin customer
      await queryRunner.manager.update(
        CampaignCustomer,
        customerMap.campaign_customer.id,
        {
          phone_number: data.phone_number.trim(),
        },
      );

      // 6. Cập nhật thông tin mapping
      await queryRunner.manager.update(
        CampaignCustomerMap,
        {
          campaign_id: Number(campaignId),
          customer_id: Number(customerId),
        },
        {
          full_name: data.full_name.trim(),
          salutation: data.salutation?.trim() || undefined,
        },
      );

      await queryRunner.commitTransaction();

      return {
        success: true,
        message: 'Cập nhật thông tin khách hàng thành công',
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAllArchived(
    query: any = {},
    user: User,
  ): Promise<CampaignResponse> {
    const roleNames = (user?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );

    const isAdmin = roleNames.includes('admin');
    const isManager = roleNames.includes('manager-chien-dich');

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      .leftJoin(
        'campaign_contents',
        'content',
        'content.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_schedules',
        'schedule',
        'schedule.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_email_reports',
        'email_report',
        'email_report.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_customer_map',
        'customer_map',
        'customer_map.campaign_id = campaign.id',
      )
      .addSelect('content.messages', 'content_messages')
      .addSelect('schedule.schedule_config', 'schedule_config')
      .addSelect('schedule.start_date', 'schedule_start_date')
      .addSelect('schedule.end_date', 'schedule_end_date')
      .addSelect('email_report.recipient_to', 'email_recipient_to')
      .addSelect('email_report.recipients_cc', 'email_recipients_cc')
      .addSelect(
        'email_report.report_interval_minutes',
        'email_report_interval_minutes',
      )
      .addSelect(
        'email_report.stop_sending_at_time',
        'email_stop_sending_at_time',
      )
      .addSelect('email_report.is_active', 'email_is_active')
      .addSelect(
        'email_report.send_when_campaign_completed',
        'email_send_when_campaign_completed',
      )
      .addSelect('COUNT(DISTINCT customer_map.customer_id)', 'customer_count')
      .groupBy('campaign.id, created_by.id, department.id')
      // ✅ CHỈ LẤY CÁC CAMPAIGN ARCHIVED
      .where('campaign.status = :archivedStatus', {
        archivedStatus: 'archived',
      });

    // Apply user-based filtering first
    if (isAdmin) {
    } else if (isManager) {
      const userDepartment = user.departments?.find(
        (dept: any) =>
          dept.server_ip !== null &&
          dept.server_ip !== undefined &&
          String(dept.server_ip).trim() !== '',
      );

      if (userDepartment) {
        qb.andWhere('campaign.department_id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        qb.andWhere('1 = 0');
      }
    } else {
      qb.andWhere('campaign.created_by_id = :userId', {
        userId: user.id,
      });
    }

    // Apply search filter
    if (query.search && query.search.trim()) {
      qb.andWhere('campaign.name LIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }

    // Apply campaign types filter - Handle both string and array
    if (query.campaign_types) {
      const typeInput = Array.isArray(query.campaign_types)
        ? query.campaign_types
        : [query.campaign_types];
      const validTypes = typeInput.filter((t) => t && String(t).trim());

      if (validTypes.length > 0) {
        qb.andWhere('campaign.campaign_type IN (:...campaignTypes)', {
          campaignTypes: validTypes,
        });
      }
    }

    // Apply single date filter
    if (query.singleDate) {
      const date = new Date(query.singleDate);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      qb.andWhere('campaign.created_at BETWEEN :startDate AND :endDate', {
        startDate: startOfDay,
        endDate: endOfDay,
      });
    }

    // Apply employee filter - Handle both string and array
    if (query.employees) {
      if (isAdmin || isManager) {
        const employeeInput = Array.isArray(query.employees)
          ? query.employees
          : [query.employees];
        const employeeIds = employeeInput
          .map((id) => parseInt(String(id), 10))
          .filter((id) => !isNaN(id));

        if (employeeIds.length > 0) {
          qb.andWhere('campaign.created_by_id IN (:...employees)', {
            employees: employeeIds,
          });
        }
      }
    }

    if (query.departments && isAdmin) {
      const departmentInput = Array.isArray(query.departments)
        ? query.departments
        : [query.departments];

      const departmentIds = departmentInput
        .map((id) => parseInt(String(id), 10))
        .filter((id) => !isNaN(id));

      if (departmentIds.length > 0) {
        qb.andWhere('department.id IN (:...departments)', {
          departments: departmentIds,
        });
      }
    }

    // Pagination
    const page = Math.max(1, parseInt(query.page) || 1);
    const pageSize = Math.max(1, parseInt(query.pageSize) || 10);
    const skip = (page - 1) * pageSize;

    qb.skip(skip).take(pageSize);
    qb.orderBy('campaign.created_at', 'DESC');

    const rawResults = await qb.getRawMany();

    // Count query with same logic
    const countQb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoin('campaign.department', 'department')
      .leftJoin('campaign.created_by', 'created_by')
      // ✅ CHỈ ĐẾM CÁC CAMPAIGN ARCHIVED
      .where('campaign.status = :archivedStatus', {
        archivedStatus: 'archived',
      });

    // Apply same user-based filtering for count
    if (isAdmin) {
      // Admin: lấy tất cả
    } else if (isManager) {
      const userDepartment = user.departments?.find(
        (dept: any) => dept.server_ip && dept.server_ip.trim() !== '',
      );

      if (userDepartment) {
        countQb.andWhere('campaign.department_id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        countQb.andWhere('1 = 0');
      }
    } else {
      countQb.andWhere('campaign.created_by_id = :userId', {
        userId: user.id,
      });
    }

    // Apply same filters for count
    if (query.search && query.search.trim()) {
      countQb.andWhere('campaign.name LIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }

    if (query.campaign_types) {
      const typeInput = Array.isArray(query.campaign_types)
        ? query.campaign_types
        : [query.campaign_types];
      const validTypes = typeInput.filter((t) => t && String(t).trim());

      if (validTypes.length > 0) {
        countQb.andWhere('campaign.campaign_type IN (:...campaignTypes)', {
          campaignTypes: validTypes,
        });
      }
    }

    if (query.singleDate) {
      const date = new Date(query.singleDate);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      countQb.andWhere('campaign.created_at BETWEEN :startDate AND :endDate', {
        startDate: startOfDay,
        endDate: endOfDay,
      });
    }

    if (query.departments && isAdmin) {
      const departmentInput = Array.isArray(query.departments)
        ? query.departments
        : [query.departments];

      const departmentIds = departmentInput
        .map((id) => parseInt(String(id), 10))
        .filter((id) => !isNaN(id));

      if (departmentIds.length > 0) {
        countQb.andWhere('department.id IN (:...departments)', {
          departments: departmentIds,
        });
      }
    }

    if (query.employees) {
      if (isAdmin || isManager) {
        const employeeInput = Array.isArray(query.employees)
          ? query.employees
          : [query.employees];
        const employeeIds = employeeInput
          .map((id) => parseInt(String(id), 10))
          .filter((id) => !isNaN(id));

        if (employeeIds.length > 0) {
          countQb.andWhere('campaign.created_by_id IN (:...employees)', {
            employees: employeeIds,
          });
        }
      }
    }

    const total = await countQb.getCount();

    // Process data same as findAll method
    const campaignIds = rawResults.map((result) => result.campaign_id);

    const allCustomerMaps =
      campaignIds.length > 0
        ? await this.campaignCustomerMapRepository
            .createQueryBuilder('map')
            .leftJoinAndSelect('map.campaign_customer', 'customer')
            .where('map.campaign_id IN (:...campaignIds)', { campaignIds })
            .getMany()
        : [];

    const customersByCampaign = allCustomerMaps.reduce(
      (acc, map) => {
        if (!acc[map.campaign_id]) acc[map.campaign_id] = [];
        acc[map.campaign_id].push({
          phone_number: map.campaign_customer.phone_number,
          full_name: map.full_name,
          salutation: map.salutation,
        });
        return acc;
      },
      {} as Record<
        string,
        Array<{
          phone_number: string;
          full_name: string;
          salutation?: string;
        }>
      >,
    );

    const data: CampaignWithDetails[] = rawResults.map((result: any) => {
      const messages = result.content_messages || [];
      const initialMessage = Array.isArray(messages)
        ? messages.find((msg) => msg.type === 'initial') || messages[0]
        : null;

      const reminderMessages = Array.isArray(messages)
        ? messages.filter((msg) => msg.type === 'reminder')
        : [];

      const scheduleConfig = result.schedule_config || {};

      let start_date: string | undefined = undefined;
      let end_date: string | undefined = undefined;

      if (result.schedule_start_date) {
        start_date =
          result.schedule_start_date instanceof Date
            ? result.schedule_start_date.toISOString()
            : result.schedule_start_date;
      }

      if (result.schedule_end_date) {
        end_date =
          result.schedule_end_date instanceof Date
            ? result.schedule_end_date.toISOString()
            : result.schedule_end_date;
      }

      return {
        id: result.campaign_id,
        name: result.campaign_name,
        campaign_type: result.campaign_campaign_type,
        status: result.campaign_status,
        send_method: result.campaign_send_method,
        created_at: result.campaign_created_at,
        updated_at: result.campaign_updated_at,
        department: {
          id: result.department_id,
          name: result.department_name,
          slug: result.department_slug,
          server_ip: result.department_server_ip,
          createdAt: result.department_createdAt,
          updatedAt: result.department_updatedAt,
          deletedAt: result.department_deletedAt,
        },
        created_by: {
          id: result.created_by_id,
          username: result.created_by_username,
          fullName: result.created_by_fullName,
          email: result.created_by_email,
          isBlock: result.created_by_isBlock,
          employeeCode: result.created_by_employeeCode,
          status: result.created_by_status,
          lastLogin: result.created_by_lastLogin,
          nickName: result.created_by_nickName,
          deletedAt: result.created_by_deletedAt,
          createdAt: result.created_by_createdAt,
          updatedAt: result.created_by_updatedAt,
          zaloLinkStatus: result.created_by_zaloLinkStatus,
          zaloName: result.created_by_zaloName,
          avatarZalo: result.created_by_avatarZalo,
          zaloGender: result.created_by_zaloGender,
          lastOnlineAt: result.created_by_lastOnlineAt,
        } as any,
        customer_count: customersByCampaign[result.campaign_id]?.length || 0,
        messages: {
          type: 'initial' as const,
          text: initialMessage?.text || '',
          attachment: initialMessage?.attachment || null,
        },
        schedule_config: {
          type: scheduleConfig.type || 'hourly',
          start_time: scheduleConfig.start_time,
          end_time: scheduleConfig.end_time,
          remind_after_minutes: scheduleConfig.remind_after_minutes,
          days_of_week: scheduleConfig.days_of_week,
          day_of_week: scheduleConfig.day_of_week,
          time_of_day: scheduleConfig.time_of_day,
        },
        reminders: reminderMessages.map((reminder: any) => ({
          content: reminder.text,
          minutes: reminder.offset_minutes,
        })),
        email_reports: result.email_recipient_to
          ? {
              recipients_to: result.email_recipient_to,
              recipients_cc: result.email_recipients_cc,
              report_interval_minutes: result.email_report_interval_minutes,
              stop_sending_at_time: result.email_stop_sending_at_time,
              is_active: result.email_is_active,
              send_when_campaign_completed:
                result.email_send_when_campaign_completed,
            }
          : undefined,
        customers: customersByCampaign[result.campaign_id] || [],
        start_date,
        end_date,
      } as CampaignWithDetails;
    });

    // Generate stats for archived campaigns only
    const stats = {
      totalCampaigns: total,
      draftCampaigns: 0,
      runningCampaigns: 0,
      completedCampaigns: 0,
      scheduledCampaigns: 0,
      archivedCampaigns: total,
    };

    return { data, total, stats };
  }

  async getCopyData(id: string, user: User): Promise<CreateCampaignDto> {
    // Tìm campaign với full data
    const campaign = await this.findOne(id, user);

    if (!campaign) {
      throw new NotFoundException('Không tìm thấy chiến dịch');
    }

    // ✅ SỬA: Chuyển campaign_id thành số
    const campaignIdNum = parseInt(id, 10);

    // ✅ SỬA: Sử dụng relation thay vì campaign_id trực tiếp
    const content = await this.campaignContentRepository
      .createQueryBuilder('content')
      .innerJoin('content.campaign', 'campaign')
      .where('campaign.id = :campaignId', { campaignId: campaignIdNum })
      .getOne();

    const schedule = await this.campaignScheduleRepository
      .createQueryBuilder('schedule')
      .innerJoin('schedule.campaign', 'campaign')
      .where('campaign.id = :campaignId', { campaignId: campaignIdNum })
      .getOne();

    const emailReport = await this.campaignEmailReportRepository
      .createQueryBuilder('email_report')
      .innerJoin('email_report.campaign', 'campaign')
      .where('campaign.id = :campaignId', { campaignId: campaignIdNum })
      .getOne();

    // Lấy danh sách customers
    const customerMaps = await this.campaignCustomerMapRepository.find({
      where: { campaign_id: campaignIdNum }, // ✅ OK: campaign_id là number trong entity
      relations: ['campaign_customer'],
    });

    // ✅ SỬA: Helper function để xử lý date an toàn
    const formatDateToISO = (date: any): string | undefined => {
      if (!date) return undefined;

      // Nếu đã là string thì return luôn
      if (typeof date === 'string') {
        // Validate xem có phải ISO string không
        const dateObj = new Date(date);
        return isNaN(dateObj.getTime()) ? undefined : date;
      }

      // Nếu là Date object thì convert
      if (date instanceof Date && !isNaN(date.getTime())) {
        return date.toISOString();
      }

      return undefined;
    };

    // ✅ SỬA: Xử lý schedule_config với proper type checking
    const createValidScheduleConfig = (
      scheduleConfig: any,
    ): ScheduleConfigDto => {
      // Default config cho trường hợp không có data hoặc data không hợp lệ
      const defaultConfig: ScheduleConfigDto = {
        type: 'hourly',
        start_time: undefined,
        end_time: undefined,
        remind_after_minutes: undefined,
        days_of_week: undefined,
        day_of_week: undefined,
        time_of_day: undefined,
      };

      if (!scheduleConfig || typeof scheduleConfig !== 'object') {
        return defaultConfig;
      }

      // Validate type field
      const validTypes = ['hourly', '3_day', 'weekly'];
      const type = validTypes.includes(scheduleConfig.type)
        ? scheduleConfig.type
        : 'hourly';

      return {
        type: type as 'hourly' | '3_day' | 'weekly',
        start_time: scheduleConfig.start_time || undefined,
        end_time: scheduleConfig.end_time || undefined,
        remind_after_minutes:
          typeof scheduleConfig.remind_after_minutes === 'number'
            ? scheduleConfig.remind_after_minutes
            : undefined,
        days_of_week: Array.isArray(scheduleConfig.days_of_week)
          ? scheduleConfig.days_of_week
          : undefined,
        day_of_week:
          typeof scheduleConfig.day_of_week === 'number'
            ? scheduleConfig.day_of_week
            : undefined,
        time_of_day: scheduleConfig.time_of_day || undefined,
      };
    };

    // ✅ SỬA: Process messages để extract initial message và reminders
    const processMessages = (messages: any) => {
      if (!Array.isArray(messages) || messages.length === 0) {
        return {
          initialMessage: undefined,
          reminders: [],
        };
      }

      const initialMessage = messages.find(
        (msg: any) => msg.type === 'initial',
      );
      const reminderMessages = messages.filter(
        (msg: any) => msg.type === 'reminder',
      );

      return {
        initialMessage,
        reminders: reminderMessages.map((reminder: any) => ({
          content: reminder.text || '',
          minutes: reminder.offset_minutes || 0,
        })),
      };
    };

    // Process messages
    const { initialMessage, reminders } = processMessages(content?.messages);

    // Process schedule config
    const validScheduleConfig = createValidScheduleConfig(
      schedule?.schedule_config,
    );

    // ✅ SỬA: Format data theo CreateCampaignDto với proper type handling
    const copyData: CreateCampaignDto = {
      name: `Copy of ${campaign.name}`, // Thêm prefix "Copy of"
      campaign_type: campaign.campaign_type,
      send_method: campaign.send_method,
      department_id: String(campaign.department.id), // ✅ Convert number to string

      // Content data - chỉ gửi initial message
      messages: initialMessage || undefined,

      // Schedule data với proper type checking
      schedule_config: validScheduleConfig,
      start_date: formatDateToISO(schedule?.start_date),
      end_date: formatDateToISO(schedule?.end_date),

      // Reminders được extract từ messages
      reminders: reminders.length > 0 ? reminders : undefined,

      // Email report data với proper validation
      email_reports: emailReport
        ? {
            recipients_to: emailReport.recipient_to,
            recipients_cc: Array.isArray(emailReport.recipients_cc)
              ? emailReport.recipients_cc
              : [],
            report_interval_minutes:
              typeof emailReport.report_interval_minutes === 'number'
                ? emailReport.report_interval_minutes
                : undefined,
            stop_sending_at_time: emailReport.stop_sending_at_time || undefined,
            is_active: Boolean(emailReport.is_active),
            send_when_campaign_completed: Boolean(
              emailReport.send_when_campaign_completed,
            ),
          }
        : undefined,

      // Customer data với validation
      customers:
        customerMaps.length > 0
          ? customerMaps.map((map) => ({
              phone_number: map.campaign_customer.phone_number,
              full_name: map.full_name,
              salutation: map.salutation || undefined,
            }))
          : undefined,
    };

    return copyData;
  }

  async exportCampaignSummary(campaignId: string, user: User) {
    // Kiểm tra quyền truy cập campaign
    const campaign = await this.checkCampaignAccess(campaignId, user);

    const campaignWithCreator = await this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'creator')
      .leftJoinAndSelect('campaign.department', 'department')
      .where('campaign.id = :campaignId', { campaignId })
      .getOne();

    if (!campaignWithCreator) {
      throw new NotFoundException('Không tìm thấy chiến dịch');
    }

    // Lấy thống kê khách hàng theo status
    const customerStats = await this.getCampaignCustomerStats(campaignId);

    // Lấy chi tiết tất cả khách hàng và logs
    const customersWithLogs =
      await this.getCampaignCustomersWithLogsDetailed(campaignId);

    // Tạo Excel workbook với metadata
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Campaign Management System';
    workbook.created = new Date();
    workbook.company = 'NKC Auto Zalo';

    // ===== ĐỊNH NGHĨA COLOR PALETTE =====
    const colors = {
      primary: 'FF4A90E2',
      secondary: 'FF7ED321',
      success: 'FF50E3C2',
      warning: 'FFFFC107',
      danger: 'FFFF6B6B',
      info: 'FF42A5F5',
      light: 'FFFAFAFA',
      lighter: 'FFF5F5F5',
      dark: 'FF333333',
      white: 'FFFFFFFF',
      border: 'FFDDDDDD',
    };

    // 📝 Font Styles
    const fontStyles = {
      title: {
        name: 'Calibri',
        size: 18,
        bold: true,
        color: { argb: colors.white },
      },
      heading: {
        name: 'Calibri',
        size: 14,
        bold: true,
        color: { argb: colors.dark },
      },
      subheading: {
        name: 'Calibri',
        size: 12,
        bold: true,
        color: { argb: colors.dark },
      },
      body: {
        name: 'Calibri',
        size: 11,
        color: { argb: colors.dark },
      },
      small: {
        name: 'Calibri',
        size: 10,
        color: { argb: 'FF666666' },
      },
    };

    // Border Styles
    const borderStyles = {
      medium: 'medium' as ExcelJS.BorderStyle,
      thin: 'thin' as ExcelJS.BorderStyle,
    };

    // Cell Styles
    const styles = {
      titleBox: {
        font: fontStyles.title,
        fill: {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: colors.primary },
        },
        alignment: {
          horizontal: 'center' as const,
          vertical: 'middle' as const,
          wrapText: true,
        },
        border: {
          top: { style: borderStyles.medium, color: { argb: colors.border } },
          bottom: {
            style: borderStyles.medium,
            color: { argb: colors.border },
          },
          left: { style: borderStyles.medium, color: { argb: colors.border } },
          right: { style: borderStyles.medium, color: { argb: colors.border } },
        },
      },
      infoLabel: {
        font: fontStyles.subheading,
        fill: {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: colors.lighter },
        },
        alignment: {
          horizontal: 'right' as const,
          vertical: 'middle' as const,
        },
        border: {
          top: { style: borderStyles.thin, color: { argb: colors.border } },
          bottom: { style: borderStyles.thin, color: { argb: colors.border } },
          left: { style: borderStyles.thin, color: { argb: colors.border } },
          right: { style: borderStyles.thin, color: { argb: colors.border } },
        },
      },
      infoValue: {
        font: fontStyles.body,
        fill: {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: colors.white },
        },
        alignment: {
          horizontal: 'left' as const,
          vertical: 'middle' as const,
        },
        border: {
          top: { style: borderStyles.thin, color: { argb: colors.border } },
          bottom: { style: borderStyles.thin, color: { argb: colors.border } },
          left: { style: borderStyles.thin, color: { argb: colors.border } },
          right: { style: borderStyles.thin, color: { argb: colors.border } },
        },
      },
      tableHeader: {
        font: fontStyles.subheading,
        fill: {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: colors.secondary },
        },
        alignment: {
          horizontal: 'center' as const,
          vertical: 'middle' as const,
          wrapText: true,
        },
        border: {
          top: { style: borderStyles.medium, color: { argb: colors.border } },
          bottom: {
            style: borderStyles.medium,
            color: { argb: colors.border },
          },
          left: { style: borderStyles.thin, color: { argb: colors.border } },
          right: { style: borderStyles.thin, color: { argb: colors.border } },
        },
      },
      tableCell: {
        font: fontStyles.body,
        fill: {
          type: 'pattern' as const,
          pattern: 'solid' as const,
          fgColor: { argb: colors.white },
        },
        alignment: {
          horizontal: 'center' as const,
          vertical: 'middle' as const,
        },
        border: {
          top: { style: borderStyles.thin, color: { argb: colors.border } },
          bottom: { style: borderStyles.thin, color: { argb: colors.border } },
          left: { style: borderStyles.thin, color: { argb: colors.border } },
          right: { style: borderStyles.thin, color: { argb: colors.border } },
        },
      },
    };

    // ===== SHEET 1: DASHBOARD TỔNG QUAN =====
    const summarySheet = workbook.addWorksheet('📊 Tổng Quan', {
      properties: { tabColor: { argb: colors.primary } },
    });

    // Title Section
    summarySheet.mergeCells('A1:F2');
    const titleCell = summarySheet.getCell('A1');
    titleCell.value = `📊 BÁO CÁO CHIẾN DỊCH: ${campaignWithCreator.name}`;
    Object.assign(titleCell, styles.titleBox);
    summarySheet.getRow(1).height = 35;

    // Timestamp
    summarySheet.mergeCells('A3:F3');
    const timestampCell = summarySheet.getCell('A3');
    timestampCell.value = `📅 Xuất lúc: ${this.formatDateTime(new Date())}`;
    timestampCell.font = fontStyles.small;
    timestampCell.alignment = { horizontal: 'center', vertical: 'middle' };
    timestampCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors.light },
    };

    summarySheet.addRow([]);

    // Thông tin chiến dịch
    const infoStartRow = 5;
    const infoData = [
      ['🏷️ Tên Chiến Dịch', campaignWithCreator.name || '--'],
      [
        '📂 Loại Chiến Dịch',
        this.getCampaignTypeLabel(campaignWithCreator.campaign_type),
      ],
      [
        '🎮 Trạng Thái',
        this.getCampaignStatusLabel(campaignWithCreator.status),
      ],
      ['📅 Ngày Tạo', this.formatDateTime(campaignWithCreator.created_at)],
      ['👤 Người Tạo', campaignWithCreator.created_by?.fullName || '--'],
      ['🏢 Phòng Ban', campaignWithCreator.department?.name || '--'],
      [
        '👥 Tổng Khách Hàng',
        (await this.getTotalCustomerCount(campaignId)).toLocaleString(),
      ],
    ];

    infoData.forEach((row, index) => {
      const rowNum = infoStartRow + index;

      const labelCell = summarySheet.getCell(`A${rowNum}`);
      labelCell.value = row[0];
      Object.assign(labelCell, styles.infoLabel);

      const valueCell = summarySheet.getCell(`B${rowNum}`);
      valueCell.value = row[1];
      Object.assign(valueCell, styles.infoValue);

      summarySheet.mergeCells(`B${rowNum}:F${rowNum}`);
    });

    summarySheet.addRow([]);

    // Thống kê section
    const statsStartRow = infoStartRow + infoData.length + 2;

    summarySheet.mergeCells(`A${statsStartRow}:F${statsStartRow}`);
    const statsTitle = summarySheet.getCell(`A${statsStartRow}`);
    statsTitle.value = '📊 THỐNG KÊ THEO TRẠNG THÁI';
    statsTitle.font = fontStyles.heading;
    statsTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    statsTitle.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors.success },
    };

    summarySheet.addRow([]);

    // Stats table headers
    const statsHeaderRow = statsStartRow + 2;
    const statsHeaders = [
      '📈 Trạng Thái',
      '👥 Số Lượng',
      '📊 Tỷ Lệ (%)',
      '📋 Ghi Chú',
    ];
    statsHeaders.forEach((header, index) => {
      const cell = summarySheet.getCell(
        String.fromCharCode(65 + index) + statsHeaderRow,
      );
      cell.value = header;
      Object.assign(cell, styles.tableHeader);
    });

    // Status colors
    const totalCustomers = Math.max(
      await this.getTotalCustomerCount(campaignId),
      1,
    );
    const statusColors = {
      pending: 'FFFFF3CD',
      sent: 'FFD1ECF1',
      failed: 'FFFADBD8',
      customer_replied: 'FFD5EDDA',
      staff_handled: 'FFDAECF0',
      reminder_sent: 'FFE8DAEF',
      no_log: 'FFF8F9FA',
    };

    const statusIcons = {
      pending: '⏳',
      sent: '✅',
      failed: '❌',
      customer_replied: '💬',
      staff_handled: '🎯',
      reminder_sent: '🔄',
      no_log: '⚪',
    };

    Object.entries(customerStats).forEach(([status, count], index) => {
      const rowNum = statsHeaderRow + 1 + index;
      const percentage = (((count as number) / totalCustomers) * 100).toFixed(
        1,
      );

      // Status column
      const statusCell = summarySheet.getCell(`A${rowNum}`);
      statusCell.value = `${statusIcons[status]} ${this.getLogStatusLabel(status)}`;
      statusCell.font = fontStyles.body;
      statusCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: statusColors[status] },
      };
      statusCell.alignment = { horizontal: 'left', vertical: 'middle' };
      statusCell.border = styles.tableCell.border;

      // Count column
      const countCell = summarySheet.getCell(`B${rowNum}`);
      countCell.value = count;
      Object.assign(countCell, styles.tableCell);
      countCell.font = { ...fontStyles.body, bold: true };

      // Percentage column
      const percentCell = summarySheet.getCell(`C${rowNum}`);
      percentCell.value = `${percentage}%`;
      Object.assign(percentCell, styles.tableCell);

      // Notes column
      const noteCell = summarySheet.getCell(`D${rowNum}`);
      const notes = {
        pending: 'Đang chờ xử lý',
        sent: 'Đã gửi thành công',
        failed: 'Gửi thất bại',
        customer_replied: 'KH đã phản hồi',
        staff_handled: 'Staff đã xử lý',
        reminder_sent: 'Đã gửi nhắc nhở',
        no_log: 'Chưa có tương tác',
      };
      noteCell.value = notes[status] || '--';
      Object.assign(noteCell, styles.tableCell);
      noteCell.font = fontStyles.small;
    });

    // Column widths for summary sheet
    summarySheet.getColumn('A').width = 30;
    summarySheet.getColumn('B').width = 15;
    summarySheet.getColumn('C').width = 15;
    summarySheet.getColumn('D').width = 35;

    summarySheet.views = [{ state: 'frozen', ySplit: 3 }];

    // ===== SHEET 2: CHI TIẾT KHÁCH HÀNG =====
    const detailSheet = workbook.addWorksheet(
      '👥 Danh Sách Khách Hàng Chi Tiết',
      {
        properties: { tabColor: { argb: colors.secondary } },
      },
    );

    // Title cho sheet 2
    detailSheet.mergeCells('A1:N2');
    const detailTitle = detailSheet.getCell('A1');
    detailTitle.value = '👥 DANH SÁCH KHÁCH HÀNG CHI TIẾT';
    Object.assign(detailTitle, styles.titleBox);
    detailSheet.getRow(1).height = 35;

    detailSheet.addRow([]);

    // Headers với thứ tự: Trạng thái gửi → Nội dung tin nhắn gửi → Ngày gửi
    const detailHeaders = [
      '#',
      'Khách hàng',
      'Số điện thoại',
      'Ngày tạo DSKH',
      'Trạng thái gửi',
      'Nội dung tin nhắn gửi',
      'Ngày Gửi',
      'Tương tác',
      'Nội dung khách phản hồi',
      'Thời gian khách phản hồi',
      'Nội dung nhân viên phản hồi',
      'Thời gian nhân viên phản hồi',
      'Chi tiết cuộc hội thoại',
      'Thời gian tương tác cuối cùng',
    ];

    const detailHeaderRow = detailSheet.addRow(detailHeaders);
    detailHeaderRow.eachCell((cell, colNumber) => {
      Object.assign(cell, styles.tableHeader);
    });
    detailHeaderRow.height = 25;

    // Data rows với căn chỉnh CENTER cho nội dung tin nhắn
    customersWithLogs.forEach((customer, index) => {
      const isEvenRow = index % 2 === 0;

      const row = detailSheet.addRow([
        index + 1,
        customer.salutation
          ? `${customer.salutation} ${customer.full_name}`
          : customer.full_name || '--',
        customer.phone_number || '--',
        customer.added_at ? this.formatDateTime(customer.added_at) : '--',
        customer.latestLog
          ? this.getLogStatusLabel(customer.latestLog.status)
          : '--',
        this.truncateText(customer.lastMessageSent || '', 150) || '--',
        customer.sent_at ? this.formatDateTime(customer.sent_at) : '--',
        customer.interactionCount ? `${customer.interactionCount} lần` : '--',
        this.truncateText(customer.lastCustomerReply || '', 150) || '--',
        customer.lastCustomerReplyAt
          ? this.formatDateTime(customer.lastCustomerReplyAt)
          : '--',
        this.truncateText(customer.lastStaffReply || '', 150) || '--',
        customer.lastStaffHandledAt
          ? this.formatDateTime(customer.lastStaffHandledAt)
          : '--',
        customer.latestLog
          ? this.getFullConversationMetadata(
              customer.latestLog.conversation_metadata,
            )
          : '--',
        customer.lastInteractionTime
          ? this.formatDateTime(customer.lastInteractionTime)
          : '--',
      ]);

      // ✅ Căn chỉnh CENTER cho tất cả các cột nội dung tin nhắn
      row.eachCell((cell, colNumber) => {
        cell.font = fontStyles.body;
        cell.border = styles.tableCell.border;

        // Căn chỉnh theo từng cột - ✅ CẬP NHẬT: Tất cả đều center
        switch (colNumber) {
          case 1: // STT
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            break;

          case 2: // Khách hàng - vẫn căn trái cho tên
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
            break;

          case 3: // Số điện thoại
          case 4: // Ngày tạo DSKH
          case 5: // Trạng thái gửi
          case 7: // Ngày Gửi
          case 8: // Tương tác
          case 10: // Thời gian khách phản hồi
          case 12: // Thời gian nhân viên phản hồi
          case 14: // Thời gian tương tác cuối cùng
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            break;

          // ✅ CẬP NHẬT: Căn CENTER cho nội dung tin nhắn với wrap text
          case 6: // Nội dung tin nhắn gửi
          case 9: // Nội dung khách phản hồi
          case 11: // Nội dung nhân viên phản hồi
            cell.alignment = {
              horizontal: 'center',
              vertical: 'middle',
              wrapText: true,
            };
            break;

          case 13: // Chi tiết cuộc hội thoại - vẫn căn trái vì nội dung JSON dài
            cell.alignment = {
              horizontal: 'left',
              vertical: 'top',
              wrapText: true,
            };
            break;

          default:
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            break;
        }

        // Alternating row colors
        if (isEvenRow) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFAFAFA' },
          };
        } else {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: colors.white },
          };
        }

        // Status column color coding
        if (colNumber === 5 && customer.latestLog) {
          const statusColor =
            statusColors[customer.latestLog.status] || 'FFF8F9FA';
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: statusColor },
          };
        }
      });

      row.height = 100;
    });

    // Column widths
    const columnWidths = [
      6, // STT
      25, // Khách hàng
      18, // Số điện thoại
      20, // Ngày tạo DSKH
      18, // Trạng thái gửi
      40, // Nội dung tin nhắn gửi
      20, // Ngày Gửi
      12, // Tương tác
      40, // Nội dung khách phản hồi
      22, // Thời gian khách phản hồi
      40, // Nội dung nhân viên phản hồi
      22, // Thời gian nhân viên phản hồi
      80, // Chi tiết cuộc hội thoại
      22, // Thời gian tương tác cuối cùng
    ];

    columnWidths.forEach((width, index) => {
      detailSheet.getColumn(index + 1).width = width;
    });

    // Freeze panes và filters
    detailSheet.views = [{ state: 'frozen', ySplit: 3 }];
    detailSheet.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: customersWithLogs.length + 3, column: detailHeaders.length },
    };

    // Print settings
    [summarySheet, detailSheet].forEach((sheet) => {
      sheet.pageSetup = {
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9,
        orientation: 'landscape',
        margins: {
          left: 0.7,
          right: 0.7,
          top: 0.7,
          bottom: 0.7,
          header: 0.3,
          footer: 0.3,
        },
      };
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    const { Readable } = require('stream');
    return Readable.from(buffer);
  }

  private getFullConversationMetadata(conversationMetadata: any): string {
    if (!conversationMetadata) {
      return '--';
    }

    try {
      let metadata = conversationMetadata;
      if (typeof conversationMetadata === 'string') {
        metadata = JSON.parse(conversationMetadata);
      }

      if (!metadata.history || !Array.isArray(metadata.history)) {
        return '--';
      }

      const convId = metadata.conv_id || 'N/A';
      const messages = metadata.history;

      const formattedMessages = messages.map((msg: any, index: number) => {
        const sender = this.getSenderLabel(msg.sender);
        const time = this.formatDateTime(msg.timestamp);
        const contentType = msg.contentType || 'TEXT';
        let content = msg.content || '';

        if (contentType === 'FILE') {
          try {
            const fileInfo = JSON.parse(content);
            content = `[FILE] ${fileInfo.fileName || 'Unknown'} (${fileInfo.fileExtension || ''}) - Size: ${this.formatFileSize(fileInfo.fileSize || 0)}`;
          } catch (error) {
            content = '[FILE] - Không thể đọc thông tin file';
          }
        }

        const truncatedContent = this.truncateText(content, 100);
        return `${index + 1}. ${sender} (${time}): ${truncatedContent}`;
      });

      const totalMessages = messages.length;
      const customerMsgs = messages.filter(
        (msg) => msg.sender === 'customer',
      ).length;
      const staffMsgs = messages.filter((msg) => msg.sender === 'staff').length;
      const fileMsgs = messages.filter(
        (msg) => msg.contentType === 'FILE',
      ).length;

      const summary = `📞 Cuộc hội thoại ID: ${convId}\n📊 Tổng: ${totalMessages} tin | 👤 KH: ${customerMsgs} | 👨‍💼 NV: ${staffMsgs} | 📎 File: ${fileMsgs}\n\n`;

      return summary + formattedMessages.join('\n');
    } catch (error) {
      return JSON.stringify(conversationMetadata, null, 2);
    }
  }

  private getSenderLabel(sender: string): string {
    switch (sender) {
      case 'customer':
        return '👤 KH';
      case 'staff':
        return '👨‍💼 NV';
      case 'bot':
        return '🤖 Bot';
      default:
        return `❓ ${sender}`;
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text || text === null || text === undefined || text === '') return '';
    return text.length > maxLength
      ? `${text.substring(0, maxLength)}...`
      : text;
  }

  private formatDateTime(date: string | Date): string {
    try {
      if (!date) return '--';

      let dateObj: Date;
      if (typeof date === 'string') {
        if (date.includes('T') && !date.includes('Z') && !date.includes('+')) {
          dateObj = new Date(date + 'Z');
        } else {
          dateObj = new Date(date);
        }
      } else {
        dateObj = date;
      }

      return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(dateObj);
    } catch {
      return '--';
    }
  }

  private async getCampaignCustomersWithLogsDetailed(campaignId: string) {
    const qb = this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoin('map.campaign_customer', 'customer')
      .leftJoin('map.campaign', 'campaign')
      .leftJoin(
        'campaign_interaction_logs',
        'log',
        'log.customer_id = customer.id AND log.campaign_id = map.campaign_id',
      )
      .select([
        'map.campaign_id as campaign_id',
        'map.customer_id as customer_id',
        'map.full_name as full_name',
        'map.salutation as salutation',
        'map.added_at as added_at',
        'customer.id as customer_id',
        'customer.phone_number as phone_number',
        'customer.created_at as customer_created_at',
        'log.id as log_id',
        'log.message_content_sent as message_content_sent',
        'log.customer_reply_content as customer_reply_content',
        'log.staff_reply_content as staff_reply_content',
        'log.status as interaction_status',
        'log.sent_at as sent_at',
        'log.customer_replied_at as customer_replied_at',
        'log.staff_handled_at as staff_handled_at',
        'log.reminder_metadata as reminder_metadata',
        'log.conversation_metadata as conversation_metadata',
        'log.error_details as error_details',
        'log.attachment_sent as attachment_sent',
      ])
      .where('map.campaign_id = :campaignId', { campaignId })
      .orderBy('map.added_at', 'DESC')
      .addOrderBy('log.sent_at', 'ASC');

    const rawResults = await qb.getRawMany();

    interface DetailedCustomerLog {
      log_id: string;
      message_content_sent: string;
      customer_reply_content: string;
      staff_reply_content: string;
      status: string;
      sent_at: Date;
      customer_replied_at: Date;
      staff_handled_at: Date;
      reminder_metadata: any;
      conversation_metadata: any;
      error_details: any;
      attachment_sent: any;
    }

    interface DetailedCustomer {
      id: string;
      phone_number: string;
      full_name: string;
      salutation: string;
      created_at: Date;
      added_at: Date;
      logs: DetailedCustomerLog[];
    }

    const groupedData: Record<string, DetailedCustomer> = rawResults.reduce(
      (acc, row) => {
        const customerId = row.customer_id;
        if (!acc[customerId]) {
          acc[customerId] = {
            id: row.customer_id,
            phone_number: row.phone_number,
            full_name: row.full_name,
            salutation: row.salutation,
            created_at: row.customer_created_at,
            added_at: row.added_at,
            logs: [],
          };
        }

        if (row.log_id) {
          acc[customerId].logs.push({
            log_id: row.log_id,
            message_content_sent: row.message_content_sent,
            customer_reply_content: row.customer_reply_content,
            staff_reply_content: row.staff_reply_content,
            status: row.interaction_status,
            sent_at: row.sent_at,
            customer_replied_at: row.customer_replied_at,
            staff_handled_at: row.staff_handled_at,
            reminder_metadata: row.reminder_metadata,
            conversation_metadata: row.conversation_metadata,
            error_details: row.error_details,
            attachment_sent: row.attachment_sent,
          });
        }

        return acc;
      },
      {},
    );

    const results: any[] = [];
    for (const customer of Object.values(groupedData)) {
      if (customer.logs.length > 0) {
        customer.logs.sort(
          (a, b) =>
            new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
        );
      }

      const latestLog = customer.logs[customer.logs.length - 1] || null;
      const interactionCount = this.getInteractionCountFromLogs(customer.logs);
      const lastInteractionTime = this.getLastInteractionTimeFromLogs(
        customer.logs,
      );
      const messageStats = this.calculateMessageStats(customer.logs);

      results.push({
        id: customer.id,
        phone_number: customer.phone_number,
        full_name: customer.full_name,
        salutation: customer.salutation,
        added_at: customer.added_at,
        created_at: customer.created_at,
        logs: customer.logs,
        latestLog: latestLog,
        totalLogs: customer.logs.length,
        interactionCount: interactionCount,
        lastInteractionTime: lastInteractionTime,
        ...messageStats,
        sent_at: latestLog?.sent_at || null,
        lastSentAt: latestLog?.sent_at || null,
        lastCustomerReplyAt: latestLog?.customer_replied_at || null,
        lastStaffHandledAt: latestLog?.staff_handled_at || null,
        lastMessageSent: this.truncateText(
          latestLog?.message_content_sent || '',
          100,
        ),
        lastCustomerReply: this.truncateText(
          latestLog?.customer_reply_content || '',
          100,
        ),
        lastStaffReply: this.truncateText(
          latestLog?.staff_reply_content || '',
          100,
        ),
      });
    }

    return results;
  }

  private getInteractionCountFromLogs(logs: any[]): number {
    let totalInteractions = 0;

    if (logs.length > 0) {
      const latestLog = logs[logs.length - 1];
      if (latestLog.conversation_metadata) {
        try {
          let metadata = latestLog.conversation_metadata;
          if (typeof metadata === 'string') {
            metadata = JSON.parse(metadata);
          }

          if (metadata.history && Array.isArray(metadata.history)) {
            totalInteractions = metadata.history.filter(
              (msg: any) => msg.sender === 'customer',
            ).length;
          }
        } catch (error) {
          totalInteractions = 0;
        }
      }
    }

    const directReplies = logs.filter(
      (log) => log.customer_reply_content,
    ).length;
    return Math.max(totalInteractions, directReplies);
  }

  private getLastInteractionTimeFromLogs(logs: any[]): string | null {
    let lastTime: string | null = null;

    if (logs.length > 0) {
      const latestLog = logs[logs.length - 1];
      if (latestLog.conversation_metadata) {
        try {
          let metadata = latestLog.conversation_metadata;
          if (typeof metadata === 'string') {
            metadata = JSON.parse(metadata);
          }

          if (metadata.history && Array.isArray(metadata.history)) {
            const customerMessages = metadata.history.filter(
              (msg: any) => msg.sender === 'customer',
            );

            if (customerMessages.length > 0) {
              const sortedMessages = customerMessages.sort(
                (a: any, b: any) =>
                  new Date(b.timestamp).getTime() -
                  new Date(a.timestamp).getTime(),
              );
              lastTime = sortedMessages[0].timestamp;
            }
          }
        } catch (error) {
          // ignore
        }
      }
    }

    const customerReplyTimes = logs
      .filter((log) => log.customer_replied_at)
      .map((log) => log.customer_replied_at)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

    if (customerReplyTimes.length > 0) {
      const latestReplyTime = customerReplyTimes[0];
      if (
        !lastTime ||
        new Date(latestReplyTime).getTime() > new Date(lastTime).getTime()
      ) {
        lastTime = latestReplyTime;
      }
    }

    return lastTime;
  }

  private calculateMessageStats(logs: any[]) {
    let conversationStats = {
      totalConversationMessages: 0,
      customerConversationMessages: 0,
      staffConversationMessages: 0,
      fileMessages: 0,
    };

    if (logs.length > 0) {
      const latestLog = logs[logs.length - 1];
      if (latestLog.conversation_metadata) {
        try {
          let metadata = latestLog.conversation_metadata;
          if (typeof metadata === 'string') {
            metadata = JSON.parse(metadata);
          }

          if (metadata.history && Array.isArray(metadata.history)) {
            conversationStats.totalConversationMessages =
              metadata.history.length;
            conversationStats.customerConversationMessages =
              metadata.history.filter(
                (msg: any) => msg.sender === 'customer',
              ).length;
            conversationStats.staffConversationMessages =
              metadata.history.filter(
                (msg: any) => msg.sender === 'staff',
              ).length;
            conversationStats.fileMessages = metadata.history.filter(
              (msg: any) => msg.contentType === 'FILE',
            ).length;
          }
        } catch (error) {
          // ignore
        }
      }
    }

    return {
      totalMessagesSent: logs.filter((log) => log.message_content_sent).length,
      totalCustomerReplies: logs.filter((log) => log.customer_reply_content)
        .length,
      totalStaffReplies: logs.filter((log) => log.staff_reply_content).length,
      totalReminders: logs.reduce((count, log) => {
        if (log.reminder_metadata && Array.isArray(log.reminder_metadata)) {
          return count + log.reminder_metadata.length;
        }
        return count;
      }, 0),
      hasErrors: logs.some((log) => log.error_details),
      statusCounts: logs.reduce(
        (counts, log) => {
          if (log.status) {
            counts[log.status] = (counts[log.status] || 0) + 1;
          }
          return counts;
        },
        {} as Record<string, number>,
      ),
      ...conversationStats,
    };
  }

  private getCampaignTypeLabel(type: string): string {
    const typeLabels = {
      hourly_km: '⏰ Khuyến mãi theo giờ',
      daily_km: '📅 Khuyến mãi hàng ngày',
      '3_day_km': '📆 Khuyến mãi 3 ngày',
      weekly_sp: '🛍️ Sản phẩm hàng tuần',
      weekly_bbg: '💎 BBG hàng tuần',
    };
    return typeLabels[type] || type || '--';
  }

  private async getTotalCustomerCount(campaignId: string): Promise<number> {
    const result = await this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .select('COUNT(map.customer_id)', 'count')
      .where('map.campaign_id = :campaignId', { campaignId })
      .getRawOne();

    return parseInt(result.count) || 0;
  }

  private getCampaignStatusLabel(status: string): string {
    const statusLabels = {
      draft: '📝 Bản nháp',
      scheduled: '⏰ Đã lên lịch',
      running: '🚀 Đang chạy',
      paused: '⏸️ Tạm dừng',
      completed: '✅ Hoàn thành',
      archived: '📦 Đã lưu trữ',
    };
    return statusLabels[status] || status || '--';
  }

  private getLogStatusLabel(status: string): string {
    const statusLabels = {
      pending: '⏳ Chờ gửi',
      sent: '✅ Đã gửi',
      failed: '❌ Gửi lỗi',
      customer_replied: '💬 KH phản hồi',
      staff_handled: '🎯 Đã xử lý',
      reminder_sent: '🔄 Đã nhắc lại',
    };
    return statusLabels[status] || status || '--';
  }

  private async getCampaignCustomerStats(
    campaignId: string,
  ): Promise<Record<string, number>> {
    const stats = await this.campaignLogRepository
      .createQueryBuilder('log')
      .innerJoin('log.campaign', 'campaign')
      .select('log.status', 'status')
      .addSelect('COUNT(DISTINCT log.customer)', 'count')
      .where('campaign.id = :campaignId', { campaignId })
      .groupBy('log.status')
      .getRawMany();

    const result: Record<string, number> = {
      pending: 0,
      sent: 0,
      failed: 0,
      customer_replied: 0,
      staff_handled: 0,
      reminder_sent: 0,
    };

    stats.forEach((stat) => {
      result[stat.status] = parseInt(stat.count);
    });

    const totalCustomers = await this.getTotalCustomerCount(campaignId);
    const customersWithLogs = Object.values(result).reduce(
      (sum, count) => sum + count,
      0,
    );
    result['no_log'] = Math.max(0, totalCustomers - customersWithLogs);

    return result;
  }
}

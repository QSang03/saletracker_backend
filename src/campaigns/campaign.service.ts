import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In, IsNull } from 'typeorm';
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

  private async getAllDepartmentSchedules(
    departmentId: number,
    campaignType: CampaignType,
  ): Promise<DepartmentSchedule[]> {
    const requiredScheduleType =
      ScheduleCalculatorHelper.getScheduleTypeByCampaignType(campaignType);

    const schedules = await this.departmentScheduleRepository.find({
      where: {
        department: { id: departmentId },
        schedule_type: requiredScheduleType,
        status: In([ScheduleStatus.ACTIVE, ScheduleStatus.INACTIVE]),
        deleted_at: IsNull(),
      },
      relations: ['department'],
      order: {
        status: 'DESC',
        created_at: 'DESC',
      },
    });

    // Sort schedules theo ngày đại diện
    const sortedSchedules = schedules.sort((a, b) => {
      const dateA = this.getRepresentativeDate(a.schedule_config);
      const dateB = this.getRepresentativeDate(b.schedule_config);

      return dateA.getTime() - dateB.getTime(); // Sort tăng dần
    });

    return sortedSchedules;
  }

  /**
   * Lấy ngày đại diện từ schedule_config để dùng cho việc sort
   */
  private getRepresentativeDate(scheduleConfig: any): Date {
    if (!scheduleConfig || !scheduleConfig.type) {
      // Fallback nếu không có config hợp lệ
      return new Date('1900-01-01');
    }

    switch (scheduleConfig.type) {
      case 'daily_dates':
        return this.getMinDateFromDailyDates(scheduleConfig.dates || []);

      case 'hourly_slots':
        return this.getMinDateFromHourlySlots(scheduleConfig.slots || []);

      default:
        // Fallback cho các type khác
        return new Date('1900-01-01');
    }
  }

  /**
   * Lấy ngày nhỏ nhất từ mảng dates trong daily_dates
   */
  private getMinDateFromDailyDates(dates: any[]): Date {
    if (!dates || dates.length === 0) {
      return new Date('1900-01-01');
    }

    const validDates = dates
      .filter((date) => date.year && date.month && date.day_of_month)
      .map((date) => new Date(date.year, date.month - 1, date.day_of_month)); // month - 1 vì Date constructor dùng 0-based month

    if (validDates.length === 0) {
      return new Date('1900-01-01');
    }

    return new Date(Math.min(...validDates.map((date) => date.getTime())));
  }

  /**
   * Lấy ngày nhỏ nhất từ applicable_date trong hourly_slots
   */
  private getMinDateFromHourlySlots(slots: any[]): Date {
    if (!slots || slots.length === 0) {
      return new Date('1900-01-01');
    }

    const validDates = slots
      .filter((slot) => slot.applicable_date)
      .map((slot) => new Date(slot.applicable_date));

    if (validDates.length === 0) {
      return new Date('1900-01-01');
    }

    return new Date(Math.min(...validDates.map((date) => date.getTime())));
  }

  /**
   * ✅ FIXED: Find best matching schedule for 3-day campaigns
   * Returns the first schedule that contains valid slots, since 3-day campaigns
   * span across multiple schedule records
   */
  private async findBestMatchingScheduleFor3Day(
    campaignScheduleConfig: any,
    departmentSchedules: DepartmentSchedule[],
  ): Promise<DepartmentSchedule | null> {
    // ✅ For 3-day campaigns, validate against ALL schedules as a group
    const isValid = this.validate3DayScheduleConfig(
      campaignScheduleConfig,
      departmentSchedules,
    );

    if (isValid && departmentSchedules.length > 0) {
      // ✅ Return the first schedule as representative
      // (since 3-day logic needs to work across multiple schedules)
      const representativeSchedule = departmentSchedules[0];
      return representativeSchedule;
    }

    this.logger.warn(
      `❌ [findBestMatchingScheduleFor3Day] No valid 3-day configuration found across ${departmentSchedules.length} schedules`,
    );
    return null;
  }

  /**
   * ✅ UPDATED: Find best matching schedule with 3-day support
   */
  private async findBestMatchingSchedule(
    campaignScheduleConfig: any,
    departmentSchedules: DepartmentSchedule[],
    campaignType: CampaignType,
  ): Promise<DepartmentSchedule | null> {
    // ✅ NEW: Special handling for 3-day campaigns
    if (campaignScheduleConfig?.type === '3_day') {
      return this.findBestMatchingScheduleFor3Day(
        campaignScheduleConfig,
        departmentSchedules,
      );
    }

    // ✅ Original logic for other campaign types
    for (const schedule of departmentSchedules) {
      const isValid = this.validateCampaignScheduleAgainstDepartment(
        campaignScheduleConfig,
        schedule.schedule_config,
        schedule.schedule_type,
      );

      if (isValid) {
        return schedule;
      }
    }

    this.logger.warn(
      `❌ [findBestMatchingSchedule] No matching schedule found`,
    );
    return null;
  }

  /**
   * Tính toán date range từ Daily Dates config với applicable_date
   */
  private calculateDateRangeFromDailyDatesWithApplicableDate(
    departmentConfig: any,
    campaignConfig: any,
  ): { startDate: Date; endDate: Date } {
    if (!departmentConfig?.dates || !Array.isArray(departmentConfig.dates)) {
      throw new Error('Invalid daily dates configuration');
    }

    const now = new Date();
    const nowDateOnly = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const futureDates: Date[] = [];

    for (const dateConfig of departmentConfig.dates) {
      let targetDate: Date;

      if (dateConfig.applicable_date) {
        // Sử dụng applicable_date cụ thể
        targetDate = new Date(dateConfig.applicable_date);
      } else {
        // Tính từ day_of_month, month, year
        const year = dateConfig.year || now.getFullYear();
        const month = dateConfig.month || now.getMonth() + 1;
        targetDate = new Date(year, month - 1, dateConfig.day_of_month);
      }

      // ✅ SỬA: Chỉ lấy ngày >= ngày hiện tại (không tính giờ)
      const targetDateOnly = new Date(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        targetDate.getDate(),
      );
      if (targetDateOnly >= nowDateOnly) {
        futureDates.push(targetDate);
      }
    }

    if (futureDates.length === 0) {
      throw new Error('No valid future dates found');
    }

    // Sắp xếp và lấy ngày gần nhất
    futureDates.sort((a, b) => a.getTime() - b.getTime());

    // ✅ CẬP NHẬT: Tính start_date và end_date theo yêu cầu
    const nearestDate = futureDates[0];
    const startDate = new Date(nearestDate);
    startDate.setHours(8, 0, 0, 0); // 8:00 AM

    const endDate = new Date(nearestDate);
    endDate.setHours(17, 45, 0, 0); // 17:45 PM (không cộng thêm giây/ms)

    return { startDate, endDate };
  }

  private async calculateDateRangeFromHourlySlotsWithApplicableDate(
    allDepartmentSchedules: DepartmentSchedule[] | any, // Accept both formats for backward compatibility
    campaignConfig: any,
    campaignType: CampaignType,
  ): Promise<{ startDate: Date; endDate: Date }> {
    // ✅ NEW: Handle both old format (single schedule config) and new format (array of schedules)
    let departmentSchedules: DepartmentSchedule[];
    
    if (Array.isArray(allDepartmentSchedules)) {
      // New format: array of DepartmentSchedule objects
      departmentSchedules = allDepartmentSchedules.filter(
        schedule => schedule.schedule_type === ScheduleType.HOURLY_SLOTS
      );
    } else {
      // Old format: single schedule config (for backward compatibility)
      // Create a fake schedule object to maintain compatibility
      departmentSchedules = [{
        schedule_config: allDepartmentSchedules,
        schedule_type: ScheduleType.HOURLY_SLOTS
      } as DepartmentSchedule];
    }

    if (departmentSchedules.length === 0) {
      throw new Error('Invalid hourly slots configuration');
    }

    // ✅ NEW: Collect all slots from all schedules
    let allSlots: any[] = [];
    for (const schedule of departmentSchedules) {
      const departmentConfig = schedule.schedule_config as any;
      if (departmentConfig?.slots && Array.isArray(departmentConfig.slots)) {
        allSlots.push(...departmentConfig.slots);
      }
    }

    const now = new Date();
    let validSlots: any[] = [];

    // ✅ UPDATED: Enhanced logic for 3-day campaigns
    let requiredDaysOfWeek: number[] = [];

    if (campaignConfig) {
      if (
        campaignConfig.type === 'weekly' &&
        campaignConfig.day_of_week !== undefined
      ) {
        requiredDaysOfWeek = [campaignConfig.day_of_week];
      } else if (
        campaignConfig.type === '3_day' &&
        campaignConfig.days_of_week &&
        Array.isArray(campaignConfig.days_of_week)
      ) {
        requiredDaysOfWeek = campaignConfig.days_of_week;
        // ✅ VALIDATE: Kiểm tra 3 ngày có liên tiếp không
        if (!this.areConsecutiveDays(requiredDaysOfWeek)) {
          this.logger.warn(
            `❌ [3-day campaign] Days [${requiredDaysOfWeek.join(',')}] are not consecutive!`,
          );
          throw new Error('3-day campaign requires consecutive days');
        }
      } else if (campaignConfig.type === 'hourly') {
        // Hourly campaign có thể chạy mọi ngày
        requiredDaysOfWeek = [];
      }
    }
    // ✅ UPDATED: Enhanced slot processing for 3-day campaigns
    for (const slot of allSlots) {
      let slotDates: Array<{ date: Date; slot: any }> = [];

      if (slot.applicable_date) {
        // ✅ Xử lý applicable_date
        const applicableDate = new Date(slot.applicable_date);
        const applicableDateOnly = new Date(
          applicableDate.getFullYear(),
          applicableDate.getMonth(),
          applicableDate.getDate(),
        );
        const nowDateOnly = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );

        if (applicableDateOnly >= nowDateOnly) {
          // ✅ NEW: For 3-day campaigns, check if this date matches any required day
          if (
            campaignConfig?.type === '3_day' &&
            requiredDaysOfWeek.length > 0
          ) {
            const dateDay = applicableDate.getDay(); // 0=Sunday, 1=Monday, etc.
            const mappedDay = dateDay === 0 ? 7 : dateDay; // Convert to 1-7 format (1=Monday, 7=Sunday)

            if (requiredDaysOfWeek.includes(mappedDay)) {
              // Check time validity for today's slots
              if (applicableDateOnly.getTime() === nowDateOnly.getTime()) {
                const [endHour, endMin] = slot.end_time.split(':').map(Number);
                const slotEndTime = new Date(now);
                slotEndTime.setHours(endHour, endMin, 0, 0);

                if (slotEndTime > now) {
                  slotDates.push({ date: applicableDate, slot });
                }
              } else {
                // Future date - always valid
                slotDates.push({ date: applicableDate, slot });
              }
            }
          } else {
            // Non-3-day logic (original)
            if (applicableDateOnly.getTime() === nowDateOnly.getTime()) {
              const [endHour, endMin] = slot.end_time.split(':').map(Number);
              const slotEndTime = new Date(now);
              slotEndTime.setHours(endHour, endMin, 0, 0);

              if (slotEndTime > now) {
                slotDates.push({ date: applicableDate, slot });
              }
            } else {
              slotDates.push({ date: applicableDate, slot });
            }
          }
        }
      } else if (slot.day_of_week !== undefined && slot.day_of_week !== null) {
        // ✅ Xử lý day_of_week
        if (
          requiredDaysOfWeek.length === 0 ||
          requiredDaysOfWeek.includes(slot.day_of_week)
        ) {
          // ✅ NEW: For 3-day campaigns, find dates for ALL required days
          if (
            campaignConfig?.type === '3_day' &&
            requiredDaysOfWeek.length > 0
          ) {
            // Find the next occurrence of this specific day
            const nextDate = this.findNextDateByDayOfWeek(
              now,
              slot.day_of_week,
            );

            // Check if today and validate end time
            const todayDay = now.getDay() === 0 ? 7 : now.getDay();
            if (slot.day_of_week === todayDay) {
              const [endHour, endMin] = slot.end_time.split(':').map(Number);
              const slotEndTime = new Date(now);
              slotEndTime.setHours(endHour, endMin, 0, 0);

              if (slotEndTime > now) {
                slotDates.push({ date: new Date(now), slot });
              }
            } else {
              slotDates.push({ date: nextDate, slot });
            }
          } else {
            // Original logic for non-3-day campaigns
            for (let i = 0; i < 30; i++) {
              const checkDate = new Date(now);
              checkDate.setDate(checkDate.getDate() + i);

              if (this.isDateMatchDayOfWeek(checkDate, slot.day_of_week)) {
                if (i === 0) {
                  const [endHour, endMin] = slot.end_time
                    .split(':')
                    .map(Number);
                  const slotEndTime = new Date(now);
                  slotEndTime.setHours(endHour, endMin, 0, 0);

                  if (slotEndTime > now) {
                    slotDates.push({ date: new Date(checkDate), slot });
                  }
                } else {
                  slotDates.push({ date: new Date(checkDate), slot });
                }
                break; // Only find the first occurrence
              }
            }
          }
        }
      } else {
        if (requiredDaysOfWeek.length === 0) {
          // Campaign type hourly - có thể chạy mọi ngày, bắt đầu từ ngày mai
          const tomorrow = new Date(now);
          tomorrow.setDate(tomorrow.getDate() + 1);
          slotDates.push({ date: tomorrow, slot });
        } else {
          // ✅ NEW: For 3-day campaigns, add dates for all required days
          if (campaignConfig?.type === '3_day') {
            return await this.calculate3DayDateRange(
              departmentSchedules, // Use the schedules array instead of departmentConfig
              campaignConfig,
              campaignType,
            );
          } else {
            // Original logic for other campaign types
            for (const dayOfWeek of requiredDaysOfWeek) {
              const nextDate = this.findNextDateByDayOfWeek(now, dayOfWeek);
              slotDates.push({ date: nextDate, slot });
            }
          }
        }
      }

      // Thêm tất cả slot dates vào danh sách
      validSlots.push(...slotDates);
    }
    if (validSlots.length === 0) {
      this.logger.error(`❌ No valid future slots found. Debug info:`);
      this.logger.error(`- All slots from all schedules:`, allSlots);
      this.logger.error(`- Campaign config:`, campaignConfig);
      this.logger.error(`- Required days of week:`, requiredDaysOfWeek);
      this.logger.error(`- Current time:`, now.toISOString());
      throw new Error('No valid future slots found');
    }

    // ✅ UPDATED: Enhanced sorting and date calculation for 3-day campaigns
    validSlots.sort((a, b) => a.date.getTime() - b.date.getTime());

    // ✅ NEW: For 3-day campaigns, find the earliest valid consecutive sequence
    if (campaignConfig?.type === '3_day' && requiredDaysOfWeek.length === 3) {
      const consecutiveSequence = this.findEarliestConsecutive3DaySequence(
        validSlots,
        requiredDaysOfWeek,
        campaignConfig,
      );

      if (consecutiveSequence) {
        return consecutiveSequence;
      } else {
        this.logger.error(
          `❌ [3-day] No valid consecutive 3-day sequence found`,
        );
        throw new Error('No valid consecutive 3-day sequence found');
      }
    }

    // ✅ Original logic for non-3-day campaigns
    const nearestSlotData = validSlots[0];
    const nearestSlot = nearestSlotData.slot;
    const targetDate = nearestSlotData.date;

    // Calculate start_date and end_date based on campaign type
    let startDate: Date;
    let endDate: Date;

    if (
      campaignConfig?.type === 'hourly' ||
      campaignType.includes('daily') ||
      campaignType.includes('hourly')
    ) {
      // ✅ SỬA: Hourly/Daily campaign - gom tất cả slots cùng ngày thay vì hardcode 8:00-17:45
      // Find all slots for the target date to get actual time range
      const slotsForTargetDay = allSlots.filter((slot) => {
        if (slot.applicable_date) {
          const slotDate = new Date(slot.applicable_date);
          return slotDate.toDateString() === targetDate.toDateString();
        } else if (slot.day_of_week !== undefined) {
          return slot.day_of_week === nearestSlot.day_of_week;
        }
        return false;
      });

      if (slotsForTargetDay.length > 0) {
        // ✅ SỬA: Tìm nhóm slots liền kề lớn nhất thay vì min-max tất cả
        const consecutiveGroup = this.findLargestConsecutiveSlotGroup(slotsForTargetDay);
        
        startDate = new Date(targetDate);
        const [startHour, startMin] = consecutiveGroup.start_time.split(':').map(Number);
        startDate.setHours(startHour, startMin, 0, 0);

        endDate = new Date(targetDate);
        const [endHour, endMin] = consecutiveGroup.end_time.split(':').map(Number);
        endDate.setHours(endHour, endMin, 0, 0);
      } else {
        // Fallback nếu không tìm thấy slots (giữ logic cũ)
        startDate = new Date(targetDate);
        startDate.setHours(8, 0, 0, 0);

        endDate = new Date(targetDate);
        endDate.setHours(17, 45, 0, 0);
      }
    } else {
      // Weekly campaigns and other types
      let campaignDuration = 1;

      if (campaignConfig?.type === 'weekly') {
        campaignDuration = 7;
      } else if (campaignConfig?.type === '3_day') {
        campaignDuration = 3;
      }

      // Find all slots for the same day to get full time range
      const slotsForThisDay = allSlots.filter((slot) => {
        if (slot.applicable_date) {
          const slotDate = new Date(slot.applicable_date);
          return slotDate.toDateString() === targetDate.toDateString();
        } else if (slot.day_of_week !== undefined) {
          return slot.day_of_week === nearestSlot.day_of_week;
        }
        return false;
      });

      let earliestStartTime = nearestSlot.start_time;
      let latestEndTime = nearestSlot.end_time;

      if (slotsForThisDay.length > 0) {
        // ✅ SỬA: Tìm nhóm slots liền kề lớn nhất thay vì min-max tất cả
        const consecutiveGroup = this.findLargestConsecutiveSlotGroup(slotsForThisDay);
        earliestStartTime = consecutiveGroup.start_time;
        latestEndTime = consecutiveGroup.end_time;
      }

      startDate = new Date(targetDate);
      const [startHour, startMin] = earliestStartTime.split(':').map(Number);
      startDate.setHours(startHour, startMin, 0, 0);

      if (campaignConfig?.type === 'weekly') {
        // Weekly campaign: same day
        endDate = new Date(targetDate);
        const [endHour, endMin] = latestEndTime.split(':').map(Number);
        endDate.setHours(endHour, endMin, 0, 0);
      } else {
        // Other campaign types
        endDate = new Date(targetDate);
        endDate.setDate(endDate.getDate() + campaignDuration - 1);
        const [endHour, endMin] = latestEndTime.split(':').map(Number);
        endDate.setHours(endHour, endMin, 0, 0);
      }
    }

    return { startDate, endDate };
  }

  private calculate3DayDateRange(
    allDepartmentSchedules: DepartmentSchedule[],
    campaignConfig: any,
    campaignType: CampaignType,
  ): Promise<{ startDate: Date; endDate: Date }> {
    const requiredDaysOfWeek = campaignConfig.days_of_week || [];
    const campaignTime = campaignConfig.time_of_day;

    // ✅ FIX: Sử dụng timezone UTC+7 (Việt Nam)
    const now = new Date();
    const vietnamTime = new Date(now.getTime() + 7 * 60 * 60 * 1000); // UTC+7

    const allValidSlots: Array<{
      date: Date;
      slot: any;
      schedule: DepartmentSchedule;
    }> = [];

    for (const schedule of allDepartmentSchedules) {
      if (
        !schedule.schedule_config ||
        !('slots' in schedule.schedule_config) ||
        !Array.isArray((schedule.schedule_config as any).slots)
      ) {
        continue;
      }

      for (const slot of schedule.schedule_config.slots) {
        let isValidSlot = false;
        let slotDate: Date | null = null;

        // ✅ FIX: Kiểm tra day_of_week và time match
        if (slot.day_of_week && requiredDaysOfWeek.includes(slot.day_of_week)) {
          // ✅ FIX: Kiểm tra time có nằm trong range không (bao gồm cả start_time)
          const timeMatches = this.isTimeInSlotRange(
            campaignTime,
            slot.start_time,
            slot.end_time,
          );

          if (timeMatches) {
            // Nếu có applicable_date thì dùng applicable_date
            if (slot.applicable_date) {
              // ✅ FIX: Parse date với timezone Việt Nam
              slotDate = this.parseVietnamDate(slot.applicable_date);

              // ✅ FIX: Validate applicable_date với day_of_week theo timezone VN
              const applicableDateDay = this.getVietnamDayOfWeek(slotDate);
              if (applicableDateDay === slot.day_of_week) {
                isValidSlot = true;
              } else {
                this.logger.warn(
                  `⚠️ [calculate3DayDateRange] applicable_date ${slot.applicable_date} (day ${applicableDateDay}) doesn't match day_of_week ${slot.day_of_week} - skipping due to timezone mismatch`,
                );
              }
            } else {
              // Không có applicable_date thì tìm ngày gần nhất có day_of_week này (theo VN timezone)
              slotDate = this.findNextDateByDayOfWeekVN(
                vietnamTime,
                slot.day_of_week,
              );

              // Kiểm tra nếu là hôm nay thì validate thời gian (theo VN timezone)
              const todayDay = this.getVietnamDayOfWeek(vietnamTime);
              if (slot.day_of_week === todayDay) {
                const [endHour, endMin] = slot.end_time.split(':').map(Number);
                const slotEndTime = new Date(vietnamTime);
                slotEndTime.setHours(endHour, endMin, 0, 0);

                if (slotEndTime > vietnamTime) {
                  isValidSlot = true;
                }
              } else {
                isValidSlot = true;
              }
            }
          }
        }

        // Thêm slot hợp lệ vào danh sách
        if (isValidSlot && slotDate) {
          allValidSlots.push({
            date: slotDate,
            slot: slot,
            schedule: schedule,
          });
        }
      }
    }

    if (allValidSlots.length === 0) {
      throw new Error(
        'No valid slots found for 3-day campaign across all schedules',
      );
    }

    // ✅ Log chi tiết các slots tìm được
    allValidSlots.forEach((slotData, index) => {
      const dayOfWeek = this.getVietnamDayOfWeek(slotData.date);
    });

    // Find earliest consecutive 3-day sequence
    const result = this.findEarliestConsecutive3DaySequence(
      allValidSlots,
      requiredDaysOfWeek,
      campaignConfig,
    );

    if (!result) {
      throw new Error('No valid consecutive 3-day sequence found');
    }

    // ✅ SỬA: Điều chỉnh time bằng cách gom slots liền kề cho từng ngày
    const firstDay = new Date(result.startDate);
    const lastDay = new Date(result.endDate);

    const firstDayVNKey = this.vietnamDateKey(firstDay);
    const lastDayVNKey = this.vietnamDateKey(lastDay);
    const firstDayOfWeek = this.getVietnamDayOfWeek(firstDay); // 1..7
    const lastDayOfWeek = this.getVietnamDayOfWeek(lastDay); // 1..7

    // ✅ SỬA: Sử dụng TẤT CẢ schedules thay vì chỉ usedSchedules để thu thập slots
    const schedulesToSearch = allDepartmentSchedules;

    // ✅ DEBUG: Log schedules được sử dụng
    schedulesToSearch.forEach(s => {
      const slots = (s as any)?.schedule_config?.slots || [];
    });

    // ✅ NEW: Thu thập slots cho TẤT CẢ ngày trong 3-day sequence
    const allDaySlots: { [dateKey: string]: any[] } = {};
    
    // Tính toán tất cả ngày trong 3-day sequence
    const allDatesInSequence: Date[] = [];
    for (let i = 0; i < 3; i++) {
      const date = new Date(firstDay);
      date.setDate(date.getDate() + i);
      allDatesInSequence.push(date);
    }

    for (const date of allDatesInSequence) {
      const dateKey = this.vietnamDateKey(date);
      const dayOfWeek = this.getVietnamDayOfWeek(date);
      allDaySlots[dateKey] = [];

      for (const schedule of schedulesToSearch) {
        const slots = (schedule as any)?.schedule_config?.slots || [];
        
        for (const slot of slots) {
          let appliesTo = false;

          if (slot.applicable_date) {
            const slotDateKey = this.vietnamDateKey(
              this.parseVietnamDate(slot.applicable_date),
            );
            if (slotDateKey === dateKey) appliesTo = true;
          } else if (slot.day_of_week) {
            if (slot.day_of_week === dayOfWeek) appliesTo = true;
          }

          if (appliesTo) {
            allDaySlots[dateKey].push(slot);
          }
        }
      }

      this.logger.log(`🔍 [calculate3DayDateRange] ${dateKey} (day ${dayOfWeek}) slots:`, 
        allDaySlots[dateKey].map(s => `${s.start_time}-${s.end_time}`).join(', '));
    }

    // ✅ NEW: Tìm time range chung cho tất cả ngày
    const commonTimeRange = this.findCommon3DayTimeRange(allDaySlots);
    
    if (!commonTimeRange) {
      this.logger.error(`❌ [calculate3DayDateRange] No common time range found for all 3 days`);
      throw new Error('No common time range found for all 3 days');
    }

    // ✅ NEW: Áp dụng common time range
    const [startHour, startMin] = commonTimeRange.start_time.split(':').map(Number);
    result.startDate.setHours(startHour, startMin, 0, 0);

    const [endHour, endMin] = commonTimeRange.end_time.split(':').map(Number);
    result.endDate.setHours(endHour, endMin, 0, 0);

    this.logger.log(`✅ [calculate3DayDateRange] Applied common time range: ${commonTimeRange.start_time} - ${commonTimeRange.end_time}`);

    return Promise.resolve(result);
  }

  private isTimeInRange(
    time: string,
    startTime: string,
    endTime: string,
  ): boolean {
    const timeMinutes = this.parseTime(time);
    const startMinutes = this.parseTime(startTime);
    const endMinutes = this.parseTime(endTime);

    return timeMinutes >= startMinutes && timeMinutes < endMinutes;
  }

  /**
   * ✅ NEW: Parse date theo timezone Việt Nam
   */
  private parseVietnamDate(dateString: string): Date {
    const date = new Date(dateString + 'T00:00:00+07:00'); // Force UTC+7
    return date;
  }

  /**
   * ✅ NEW: Lấy day of week theo timezone Việt Nam (2-7: Thứ 2-7)
   */
  private getVietnamDayOfWeek(date: Date): number {
    // Chuyển sang timezone Việt Nam
    const vietnamTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    const jsDay = vietnamTime.getUTCDay(); // 0=CN, 1=T2, ..., 6=T7

    // Chuẩn hóa: 1=CN, 2=T2, ..., 7=T7
    // => T2..T7 tương ứng 2..7; CN=1 (không dùng trong yêu cầu 2..7)
    return jsDay === 0 ? 1 : jsDay + 1;
  }

  /**
   * Tạo key ngày theo timezone Việt Nam (YYYY-MM-DD)
   */
  private vietnamDateKey(date: Date): string {
    const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000);
    const y = vn.getUTCFullYear();
    const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
    const d = String(vn.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * ✅ NEW: Tìm ngày gần nhất theo day_of_week trong timezone VN
   */
  private findNextDateByDayOfWeekVN(fromDate: Date, dayOfWeek: number): Date {
    const vietnamTime = new Date(fromDate.getTime() + 7 * 60 * 60 * 1000);

    // dayOfWeek: 2=T2, 3=T3, ..., 7=T7
    // JavaScript getUTCDay(): 0=CN, 1=T2, 2=T3, ..., 6=T7
    const targetJSDay = dayOfWeek === 7 ? 0 : dayOfWeek - 1;

    let daysToAdd = (targetJSDay - vietnamTime.getUTCDay() + 7) % 7;
    if (daysToAdd === 0) {
      daysToAdd = 7; // Nếu hôm nay đúng thứ cần tìm, lấy tuần sau
    }

    const result = new Date(
      vietnamTime.getTime() + daysToAdd * 24 * 60 * 60 * 1000,
    );
    return result;
  }

  /**
   * ✅ FIX: Kiểm tra time có nằm trong slot range không (bao gồm start_time)
   */
  private isTimeInSlotRange(
    time: string,
    startTime: string,
    endTime: string,
  ): boolean {
    const timeMinutes = this.parseTime(time);
    const startMinutes = this.parseTime(startTime);
    const endMinutes = this.parseTime(endTime);

    // ✅ FIX: Bao gồm cả start_time (>= thay vì >)
    return timeMinutes >= startMinutes && timeMinutes < endMinutes;
  }

  /**
   * ✅ NEW: Helper method to check if days are consecutive
   */
  private areConsecutiveDays(days: number[]): boolean {
    if (days.length < 2) return true;

    const sortedDays = [...days].sort((a, b) => a - b);

    for (let i = 1; i < sortedDays.length; i++) {
      const diff = sortedDays[i] - sortedDays[i - 1];

      // Check for normal consecutive days (1, 2, 3) or wrap-around (7, 1, 2)
      if (diff !== 1 && !(sortedDays[i - 1] === 7 && sortedDays[i] === 1)) {
        return false;
      }
    }

    return true;
  }

  /**
   * ✅ NEW: Find earliest consecutive 3-day sequence with proper time validation
   */
  private findEarliestConsecutive3DaySequence(
    validSlots: Array<{ date: Date; slot: any; schedule?: DepartmentSchedule }>,
    requiredDaysOfWeek: number[],
    campaignConfig: any,
  ): {
    startDate: Date;
    endDate: Date;
    usedSchedules?: DepartmentSchedule[];
    usedSlots?: Array<{ date: Date; slot: any; schedule?: DepartmentSchedule }>;
  } | null {
    const sortedDays = [...requiredDaysOfWeek].sort((a, b) => a - b);
    const campaignTime = campaignConfig.time_of_day;

    // Group slots by VN date and VN day of week
    const slotsByDate = new Map<string, Array<{ date: Date; slot: any }>>();
    const slotsByDayOfWeek = new Map<
      number,
      Array<{ date: Date; slot: any }>
    >();

    for (const slotData of validSlots) {
      const dateKey = this.vietnamDateKey(slotData.date);
      const dayOfWeek = this.getVietnamDayOfWeek(slotData.date); // 1=CN, 2..7=T2..T7

      // Bỏ qua CN (1) vì yêu cầu 2..7
      if (dayOfWeek === 1) continue;

      // Group by date
      if (!slotsByDate.has(dateKey)) {
        slotsByDate.set(dateKey, []);
      }
      slotsByDate.get(dateKey)!.push(slotData);

      // Group by day of week
      if (!slotsByDayOfWeek.has(dayOfWeek)) {
        slotsByDayOfWeek.set(dayOfWeek, []);
      }
      slotsByDayOfWeek.get(dayOfWeek)!.push(slotData);
    }

    // Check if we have all required days available
    for (const requiredDay of sortedDays) {
      if (!slotsByDayOfWeek.has(requiredDay)) {
        this.logger.error(
          `❌ [3-day sequence] Missing slots for day ${requiredDay}`,
        );
        return null;
      }
    }

    // Find earliest possible start date that has all 3 consecutive days
    const now = new Date();
    const maxSearchDays = 90; // Search up to 3 months ahead

    for (let offset = 0; offset < maxSearchDays; offset++) {
      const checkDate = new Date(now);
      checkDate.setDate(checkDate.getDate() + offset);
      checkDate.setHours(0, 0, 0, 0);

      const checkDayOfWeek = this.getVietnamDayOfWeek(checkDate); // 1..7

      // Check if this date matches the first required day
      if (checkDayOfWeek === sortedDays[0]) {
        // Verify we have consecutive days and valid time slots
        const consecutiveDates: Date[] = [];
        let isValidSequence = true;
        let earliestStartTime = '23:59';
        let latestEndTime = '00:00';

        const selectedSlots: Array<{
          date: Date;
          slot: any;
          schedule?: DepartmentSchedule;
        } | null> = [null, null, null];

        for (let dayIndex = 0; dayIndex < 3; dayIndex++) {
          const sequenceDate = new Date(checkDate);
          sequenceDate.setDate(sequenceDate.getDate() + dayIndex);
          const sequenceDayOfWeek = this.getVietnamDayOfWeek(sequenceDate);

          // Check if this day matches our required sequence
          if (sequenceDayOfWeek !== sortedDays[dayIndex]) {
            isValidSequence = false;
            break;
          }

          // Find slots for this specific date that match our time requirement
          const slotsForThisDay = slotsByDayOfWeek.get(sequenceDayOfWeek) || [];
          let hasValidTimeSlot = false;

          for (const slotData of slotsForThisDay) {
            // Check if slot date matches our sequence date (for applicable_date slots)
            // Or if it's a day_of_week slot that applies to this day
            const isApplicableSlot = slotData.slot.applicable_date
              ? this.vietnamDateKey(slotData.date) ===
                this.vietnamDateKey(sequenceDate)
              : true; // day_of_week slots apply to all matching days

            if (isApplicableSlot) {
              // Check if campaign time fits within slot time range
              const slotStart = this.parseTime(slotData.slot.start_time);
              const slotEnd = this.parseTime(slotData.slot.end_time);
              const campaignTimeParsed = this.parseTime(campaignTime);

              if (
                campaignTimeParsed >= slotStart &&
                campaignTimeParsed < slotEnd
              ) {
                // Check if slot is still valid (not in the past for today)
                if (
                  this.vietnamDateKey(sequenceDate) === this.vietnamDateKey(now)
                ) {
                  const slotEndTime = new Date(now);
                  const [endHour, endMin] = slotData.slot.end_time
                    .split(':')
                    .map(Number);
                  slotEndTime.setHours(endHour, endMin, 0, 0);

                  if (slotEndTime <= now) {
                    continue; // Skip past slots for today
                  }
                }

                hasValidTimeSlot = true;

                // Update time range
                if (
                  this.parseTime(slotData.slot.start_time) <
                  this.parseTime(earliestStartTime)
                ) {
                  earliestStartTime = slotData.slot.start_time;
                }
                if (
                  this.parseTime(slotData.slot.end_time) >
                  this.parseTime(latestEndTime)
                ) {
                  latestEndTime = slotData.slot.end_time;
                }
                selectedSlots[dayIndex] = slotData as any;
                break;
              }
            }
          }

          if (!hasValidTimeSlot) {
            isValidSequence = false;
            break;
          }

          consecutiveDates.push(sequenceDate);
        }

        if (isValidSequence && consecutiveDates.length === 3) {
          // Calculate start and end dates
          const startDate = new Date(consecutiveDates[0]);
          const [startHour, startMin] = earliestStartTime
            .split(':')
            .map(Number);
          startDate.setHours(startHour, startMin, 0, 0);

          const endDate = new Date(consecutiveDates[2]);
          const [endHour, endMin] = latestEndTime.split(':').map(Number);
          endDate.setHours(endHour, endMin, 0, 0);

          // Collect used schedules (unique)
          const usedSchedulesMap = new Map<string, DepartmentSchedule>();
          selectedSlots.forEach((s) => {
            if (s?.schedule)
              usedSchedulesMap.set(String(s.schedule.id), s.schedule);
          });

          const usedSchedules = Array.from(usedSchedulesMap.values());

          return {
            startDate,
            endDate,
            usedSchedules,
            usedSlots: selectedSlots.filter(Boolean) as Array<{
              date: Date;
              slot: any;
              schedule?: DepartmentSchedule;
            }>,
          };
        }
      }
    }

    this.logger.error(
      `❌ [3-day sequence] No valid consecutive sequence found within ${maxSearchDays} days`,
    );
    return null;
  }

  /**
   * Tìm ngày gần nhất có day_of_week cụ thể (từ hiện tại trở đi)
   * @param fromDate - Ngày bắt đầu tìm
   * @param dayOfWeek - Thứ cần tìm (2-7: Thứ 2-7)
   */
  private findNextDateByDayOfWeek(fromDate: Date, dayOfWeek: number): Date {
    // Validate input
    if (dayOfWeek < 2 || dayOfWeek > 7) {
      throw new Error(
        `Invalid day_of_week: ${dayOfWeek}. Must be between 2-7 (Monday-Sunday)`,
      );
    }

    const result = new Date(fromDate);

    // dayOfWeek: 2=Thứ 2, 3=Thứ 3, ..., 7=Thứ 7
    // JavaScript getDay(): 0=CN, 1=T2, 2=T3, ..., 6=T7
    const targetJSDay = dayOfWeek - 1; // 2..7 -> 1..6 (T2..T7)

    let daysToAdd = (targetJSDay - result.getDay() + 7) % 7;
    if (daysToAdd === 0) {
      // Nếu hôm nay đúng thứ cần tìm, lấy tuần sau
      daysToAdd = 7;
    }

    result.setDate(result.getDate() + daysToAdd);

    return result;
  }

  /**
   * Kiểm tra ngày có khớp với day_of_week không
   * @param date - Ngày cần kiểm tra
   * @param dayOfWeek - Thứ cần khớp (2-7: Thứ 2-7)
   */
  private isDateMatchDayOfWeek(date: Date, dayOfWeek: number): boolean {
    // Validate input
    if (dayOfWeek < 2 || dayOfWeek > 7) {
      this.logger.warn(
        `Invalid day_of_week: ${dayOfWeek}. Must be between 2-7`,
      );
      return false;
    }

    // dayOfWeek: 2=Thứ 2, 3=Thứ 3, ..., 7=Thứ 7
    // JavaScript getDay(): 0=CN, 1=T2, 2=T3, ..., 6=T7
    const jsDay = date.getDay();
    const expectedJSDay = dayOfWeek - 1; // 2..7 -> 1..6
    const matches = jsDay === expectedJSDay;

    return matches;
  }

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
    const schedule = await this.departmentScheduleRepository.findOne({
      where: {
        department: { id: departmentId },
        schedule_type: requiredScheduleType,
        status: ScheduleStatus.ACTIVE,
      },
      relations: ['department'],
    });

    if (!schedule) {
      this.logger.warn(
        `❌ [getDepartmentActiveSchedule] No active schedule found for department ${departmentId} with type ${requiredScheduleType}`,
      );

      // Let's also check what schedules exist for this department
      const allSchedules = await this.departmentScheduleRepository.find({
        where: { department: { id: departmentId } },
        relations: ['department'],
      });
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
    if (
      !campaignConfig?.day_of_week ||
      !campaignConfig?.time_of_day ||
      !departmentConfig?.slots
    ) {
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
      const isTimeValid =
        campaignTimeParsed >= deptStart && campaignTimeParsed < deptEnd;

      return isTimeValid;
    });

    if (!found) {
      this.logger.warn(
        `❌ Weekly schedule invalid: day_of_week=${campaignDay}, time=${campaignTime} ` +
          `not found within any department schedule slots`,
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
    if (
      !campaignConfig?.start_time ||
      !campaignConfig?.end_time ||
      !departmentConfig?.slots
    ) {
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
          `not found within any department schedule slots`,
      );
      return false;
    }

    return true;
  }

  /**
   * ✅ UPDATED: Sử dụng timezone VN cho validation
   */
  private validate3DayScheduleConfig(
    campaignConfig: any,
    departmentSchedules: any,
  ): boolean {
    if (
      !campaignConfig?.days_of_week ||
      !campaignConfig?.time_of_day ||
      !departmentSchedules ||
      departmentSchedules.length === 0
    ) {
      this.logger.warn(`Missing required fields in 3-day schedule config`);
      return false;
    }

    const campaignDays = campaignConfig.days_of_week;
    const campaignTime = campaignConfig.time_of_day;

    // Collect all slots from all department schedules
    const allSlots: Array<{ schedule: DepartmentSchedule; slot: any }> = [];

    departmentSchedules.forEach((schedule) => {
      if (
        schedule.schedule_config?.slots &&
        Array.isArray(schedule.schedule_config.slots)
      ) {
        schedule.schedule_config.slots.forEach((slot) => {
          allSlots.push({ schedule, slot });
        });
      }
    });
    // Check each day in the 3-day sequence
    for (const dayOfWeek of campaignDays) {
      const foundMatchingSlot = allSlots.some(({ slot }) => {
        // Check day_of_week match
        if (slot.day_of_week !== dayOfWeek) {
          return false;
        }

        // ✅ FIX: Sử dụng logic time range mới
        const isTimeValid = this.isTimeInSlotRange(
          campaignTime,
          slot.start_time,
          slot.end_time,
        );

        return isTimeValid;
      });

      if (!foundMatchingSlot) {
        this.logger.warn(
          `❌ [validate3DayScheduleConfig] No matching slot found for day_of_week=${dayOfWeek}, time=${campaignTime}`,
        );
        return false;
      }
    }
    return true;
  }

  /**
   * ✅ NEW: Tìm tất cả consecutive groups trong một ngày
   * @param slots - Danh sách slots của ngày đó
   * @returns Array of consecutive groups với start_time và end_time
   */
  private findAllConsecutiveGroups(slots: any[]): Array<{ start_time: string; end_time: string }> {
    if (slots.length === 0) return [];

    // Sắp xếp slots theo start_time
    const sortedSlots = slots.sort((a, b) => 
      this.parseTime(a.start_time) - this.parseTime(b.start_time)
    );

    const groups: Array<{ start_time: string; end_time: string }> = [];
    let currentGroup: any[] = [sortedSlots[0]];

    for (let i = 1; i < sortedSlots.length; i++) {
      const currentSlot = sortedSlots[i];
      const previousSlot = currentGroup[currentGroup.length - 1];

      // Kiểm tra slot hiện tại có liền kề với slot trước không
      if (previousSlot.end_time === currentSlot.start_time) {
        // Liền kề - thêm vào nhóm hiện tại
        currentGroup.push(currentSlot);
      } else {
        // Không liền kề - kết thúc nhóm hiện tại
        groups.push({
          start_time: currentGroup[0].start_time,
          end_time: currentGroup[currentGroup.length - 1].end_time
        });
        // Bắt đầu nhóm mới
        currentGroup = [currentSlot];
      }
    }

    // Thêm nhóm cuối cùng
    groups.push({
      start_time: currentGroup[0].start_time,
      end_time: currentGroup[currentGroup.length - 1].end_time
    });

    return groups;
  }

  /**
   * ✅ NEW: Tìm time range chung lớn nhất cho tất cả ngày trong 3-day campaign
   * @param allDaySlots - Object chứa slots của từng ngày
   * @returns Common time range hoặc null nếu không có
   */
  private findCommon3DayTimeRange(allDaySlots: { [dateKey: string]: any[] }): { start_time: string; end_time: string } | null {
    const dateKeys = Object.keys(allDaySlots);
    if (dateKeys.length === 0) return null;

    // Tìm tất cả consecutive groups cho từng ngày
    const allDayGroups: { [dateKey: string]: Array<{ start_time: string; end_time: string }> } = {};
    
    for (const dateKey of dateKeys) {
      const slots = allDaySlots[dateKey];
      allDayGroups[dateKey] = this.findAllConsecutiveGroups(slots);
      
      // debug logs removed
    }

    // Tìm intersection của tất cả groups
    let commonGroups = allDayGroups[dateKeys[0]]; // Bắt đầu với groups của ngày đầu

    for (let i = 1; i < dateKeys.length; i++) {
      const currentDayGroups = allDayGroups[dateKeys[i]];
      const intersection: Array<{ start_time: string; end_time: string }> = [];

      for (const commonGroup of commonGroups) {
        for (const currentGroup of currentDayGroups) {
          // Tìm phần giao giữa 2 time ranges
          const intersectionStart = Math.max(
            this.parseTime(commonGroup.start_time),
            this.parseTime(currentGroup.start_time)
          );
          const intersectionEnd = Math.min(
            this.parseTime(commonGroup.end_time),
            this.parseTime(currentGroup.end_time)
          );

          if (intersectionStart < intersectionEnd) {
            // Có giao - thêm vào intersection
            intersection.push({
              start_time: this.minutesToTime(intersectionStart),
              end_time: this.minutesToTime(intersectionEnd)
            });
          }
        }
      }

      commonGroups = intersection;
      if (commonGroups.length === 0) {
    // debug logs removed
        return null; // Không có giao
      }
    }

    // Chọn common group lớn nhất
    let largestGroup = commonGroups[0];
    let largestDuration = this.parseTime(largestGroup.end_time) - this.parseTime(largestGroup.start_time);

    for (const group of commonGroups) {
      const duration = this.parseTime(group.end_time) - this.parseTime(group.start_time);
      if (duration > largestDuration) {
        largestGroup = group;
        largestDuration = duration;
      }
    }

  // debug logs removed
    return largestGroup;
  }

  /**
   * ✅ NEW: Convert minutes to time string (HH:MM)
   */
  private minutesToTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  /**
   * ✅ NEW: Tìm nhóm slots liền kề lớn nhất từ danh sách slots
   * @param slots - Danh sách slots cần kiểm tra
   * @returns { start_time, end_time } của nhóm liền kề lớn nhất
   */
  private findLargestConsecutiveSlotGroup(slots: any[]): { start_time: string; end_time: string } {
    if (slots.length === 0) {
      throw new Error('No slots provided');
    }

    // debug logs removed
    // Sắp xếp slots theo start_time
    const sortedSlots = slots.sort((a, b) => 
      this.parseTime(a.start_time) - this.parseTime(b.start_time)
    );

    // debug logs removed
    let largestGroup: any[] = [];
    let currentGroup: any[] = [sortedSlots[0]];

    for (let i = 1; i < sortedSlots.length; i++) {
      const currentSlot = sortedSlots[i];
      const previousSlot = currentGroup[currentGroup.length - 1];

  // debug logs removed

      // Kiểm tra slot hiện tại có liền kề với slot trước không
      if (previousSlot.end_time === currentSlot.start_time) {
        // Liền kề - thêm vào nhóm hiện tại
        currentGroup.push(currentSlot);
  // debug logs removed
      } else {
        // Không liền kề - kết thúc nhóm hiện tại
        if (currentGroup.length > largestGroup.length) {
          largestGroup = [...currentGroup];
          // debug logs removed
        }
        // Bắt đầu nhóm mới
        currentGroup = [currentSlot];
  // debug logs removed
      }
    }

    // Kiểm tra nhóm cuối cùng
    if (currentGroup.length > largestGroup.length) {
      largestGroup = [...currentGroup];
  // debug logs removed
    }

    const result = {
      start_time: largestGroup[0].start_time,
      end_time: largestGroup[largestGroup.length - 1].end_time
    };

  // debug logs removed

    return result;
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
    // 1. Get ALL department schedules (bao gồm cả INACTIVE)
    const departmentSchedules = await this.getAllDepartmentSchedules(
      campaign.department.id,
      campaign.campaign_type,
    );

    if (!departmentSchedules || departmentSchedules.length === 0) {
      const requiredScheduleType =
        ScheduleCalculatorHelper.getScheduleTypeByCampaignType(
          campaign.campaign_type,
        );
      this.logger.error(
        `❌ [setupCampaignScheduleDates] No schedules found for department ${campaign.department.id}, required type: ${requiredScheduleType}`,
      );
      throw new Error('chưa có lịch hoạt động');
    }

    // 2. Get campaign schedule config
    const campaignSchedule = await this.campaignScheduleRepository.findOne({
      where: { campaign: { id: campaign.id } },
    });

    let shouldSetNullDates = false;

    // 3. Validate campaign schedule config và tìm best matching schedule
    let bestMatchingSchedule: DepartmentSchedule | null = null;

    if (campaignSchedule?.schedule_config) {
      // Tìm schedule phù hợp nhất từ tất cả schedules
      bestMatchingSchedule = await this.findBestMatchingSchedule(
        campaignSchedule.schedule_config,
        departmentSchedules,
        campaign.campaign_type,
      );

      if (!bestMatchingSchedule) {
        this.logger.warn(
          `⚠️ [setupCampaignScheduleDates] No matching schedule found - will set dates to null`,
        );
        shouldSetNullDates = true;
      } else {
      }
    } else {
      bestMatchingSchedule = departmentSchedules[0];
    }

    // 4. Calculate date range hoặc set null dates
    if (shouldSetNullDates || !bestMatchingSchedule) {
      await this.updateCampaignScheduleDates(campaign.id, null, null);
    } else {
      // Tính toán dates từ matching schedule
      let dateRange: { startDate: Date; endDate: Date };

      try {
        if (bestMatchingSchedule.schedule_type === ScheduleType.DAILY_DATES) {
          dateRange = this.calculateDateRangeFromDailyDatesWithApplicableDate(
            bestMatchingSchedule.schedule_config as any,
            campaignSchedule?.schedule_config,
          );
        } else if (
          bestMatchingSchedule.schedule_type === ScheduleType.HOURLY_SLOTS
        ) {
          // 🔍 KIỂM TRA CAMPAIGN TYPE để quyết định logic tính toán
          if (
            campaign.campaign_type.includes('hourly') ||
            campaign.campaign_type.includes('daily')
          ) {
            // ✅ SỬA: Truyền tất cả schedules để gom slots cùng ngày
            dateRange = await this.calculateDateRangeFromHourlySlotsWithApplicableDate(
              departmentSchedules, // Pass all schedules instead of just one
              campaignSchedule?.schedule_config,
              campaign.campaign_type,
            );
          } else {
            if (campaignSchedule?.schedule_config?.type === '3_day') {
              dateRange = await this.calculate3DayDateRange(
                departmentSchedules, // Pass all schedules
                campaignSchedule.schedule_config,
                campaign.campaign_type,
              );
            } else {
              // ✅ SỬA: Truyền tất cả schedules để gom slots cùng ngày
              dateRange =
                await this.calculateDateRangeFromHourlySlotsWithApplicableDate(
                  departmentSchedules, // Pass all schedules instead of just one
                  campaignSchedule?.schedule_config,
                  campaign.campaign_type,
                );
            }
          }
        } else {
          throw new Error(
            `Unsupported schedule type: ${bestMatchingSchedule.schedule_type}`,
          );
        }

        await this.updateCampaignScheduleDates(
          campaign.id,
          dateRange.startDate,
          dateRange.endDate,
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

    if (now < startDate || now > endDate) {
      this.logger.error(
        `❌ [validateCurrentTimeInSchedule] Time validation failed - outside allowed range`,
      );
      throw new Error('không trong khung thời gian');
    }

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
    const isViewRole = roleNames.includes('view');
    const isManager = roleNames.includes('manager-chien-dich');

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      .where('campaign.id = :id', { id: campaignId });

    if (isAdmin || isViewRole) {
      // Admin và role view: có thể truy cập tất cả campaign
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
    const isViewRole = roleNames.includes('view');
    const isManager = roleNames.includes('manager-chien-dich');

    // ✅ FIXED: Simplified query to avoid duplicate rows
    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      .where('campaign.status != :archivedStatus', {
        archivedStatus: 'archived',
      });

    // Apply user-based filtering first
    if (isAdmin || isViewRole) {
      // Admin và role view: có thể truy cập tất cả campaign
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

    // ✅ Get total count before pagination
    const total = await qb.getCount();

    // ✅ Load all campaigns (without pagination) for proper sort by status, then created_at
    const allCampaigns = await qb.getMany();
    if (allCampaigns.length === 0) {
      const stats = await this.getStats(user);
      return { data: [], total: 0, stats };
    }

    // ✅ Sort in-memory by status first, then by created_at desc
    const statusOrder: Record<string, number> = {
      scheduled: 1,
      running: 2,
      draft: 3,
      paused: 4,
      completed: 5,
    };

    const sortedCampaigns = allCampaigns.sort((a, b) => {
      const sa = statusOrder[a.status] ?? 999;
      const sb = statusOrder[b.status] ?? 999;
      if (sa !== sb) return sa - sb;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });

    // ✅ Apply pagination on the sorted list
    const page = Math.max(1, parseInt(query.page) || 1);
    const pageSize = Math.max(1, parseInt(query.pageSize) || 10);
    const skip = (page - 1) * pageSize;
    const pagedCampaigns = sortedCampaigns.slice(skip, skip + pageSize);
    const campaignIds = pagedCampaigns.map((c) => c.id);

    // ✅ Fetch related data only for the paged campaigns
    const [contents, schedules, emailReports, customerCounts, allCustomerMaps] =
      await Promise.all([
        this.campaignContentRepository
          .createQueryBuilder('content')
          .leftJoinAndSelect('content.campaign', 'campaign')
          .where('content.campaign_id IN (:...campaignIds)', { campaignIds })
          .getMany(),
        this.campaignScheduleRepository
          .createQueryBuilder('schedule')
          .leftJoinAndSelect('schedule.campaign', 'campaign')
          .where('schedule.campaign_id IN (:...campaignIds)', { campaignIds })
          .getMany(),
        this.campaignEmailReportRepository
          .createQueryBuilder('email')
          .leftJoinAndSelect('email.campaign', 'campaign')
          .where('email.campaign_id IN (:...campaignIds)', { campaignIds })
          .getMany(),
        this.campaignCustomerMapRepository
          .createQueryBuilder('map')
          .select('map.campaign_id', 'campaign_id')
          .addSelect('COUNT(DISTINCT map.customer_id)', 'customer_count')
          .where('map.campaign_id IN (:...campaignIds)', { campaignIds })
          .groupBy('map.campaign_id')
          .getRawMany(),
        this.campaignCustomerMapRepository
          .createQueryBuilder('map')
          .leftJoinAndSelect('map.campaign_customer', 'customer')
          .where('map.campaign_id IN (:...campaignIds)', { campaignIds })
          .getMany(),
      ]);

    // ✅ Build lookup maps
    const contentMap = new Map(contents.map((c) => [c.campaign.id, c]));
    const scheduleMap = new Map(schedules.map((s) => [s.campaign.id, s]));
    const emailMap = new Map(emailReports.map((e) => [e.campaign.id, e]));
    const countMap = new Map(
      customerCounts.map((c) => [c.campaign_id, parseInt(c.customer_count)]),
    );
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

    // ✅ Build final page data with details
    const data: CampaignWithDetails[] = pagedCampaigns.map(
      (campaign: Campaign) => {
        const content = contentMap.get(campaign.id);
        const schedule = scheduleMap.get(campaign.id);
        const emailReport = emailMap.get(campaign.id);
        const customerCount = countMap.get(campaign.id) || 0;

        const messages = content?.messages || [];
        const initialMessage = Array.isArray(messages)
          ? messages.find((msg) => msg.type === 'initial') || messages[0]
          : null;

        const reminderMessages = Array.isArray(messages)
          ? messages.filter((msg) => msg.type === 'reminder')
          : [];

        const scheduleConfig = schedule?.schedule_config || {};

        let start_date: string | undefined = undefined;
        let end_date: string | undefined = undefined;

        if (schedule?.start_date) {
          start_date = new Date(schedule.start_date).toISOString();
        }
        if (schedule?.end_date) {
          end_date = new Date(schedule.end_date).toISOString();
        }

        return {
          ...campaign,
          customer_count: customerCount,
          messages: initialMessage || {
            type: 'initial',
            text: '',
            attachment: null,
          },
          schedule_config: scheduleConfig,
          reminders: reminderMessages.map((msg: any) => ({
            content: msg.text || '',
            minutes: msg.offset_minutes || 0,
          })),
          email_reports: emailReport
            ? {
                recipients_to: emailReport.recipient_to || '',
                recipients_cc: emailReport.recipients_cc || [],
                report_interval_minutes: emailReport.report_interval_minutes,
                stop_sending_at_time: emailReport.stop_sending_at_time,
                is_active: emailReport.is_active || false,
                send_when_campaign_completed:
                  emailReport.send_when_campaign_completed || false,
              }
            : undefined,
          customers: customersByCampaign[campaign.id] || [],
          start_date,
          end_date,
        } as CampaignWithDetails;
      },
    );

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
    try {
      // Kiểm tra quyền truy cập và lấy campaign
      const campaign = await this.checkCampaignAccess(id, user);

      // Validate status transitions
      this.validateStatusTransition(campaign.status, status);

      // ✨ THÊM LOGIC SCHEDULE
      if (
        campaign.status === CampaignStatus.DRAFT &&
        status === CampaignStatus.SCHEDULED
      ) {
        await this.setupCampaignScheduleDates(campaign);
      } else if (
        campaign.status === CampaignStatus.SCHEDULED &&
        status === CampaignStatus.RUNNING
      ) {
        await this.validateCurrentTimeInSchedule(campaign);
      } else if (
        campaign.status === CampaignStatus.SCHEDULED &&
        status === CampaignStatus.DRAFT
      ) {
        await this.resetCampaignScheduleDates(campaign.id);
      } else {
      }

      // Update campaign status
      await this.campaignRepository.update(id, { status });

      // Return updated campaign with full details
      const result = await this.findOne(id, user);

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

        // Chỉ thêm log nếu có sent_at hoặc status = 'failed'
        if (row.sent_at || row.interaction_status === 'failed') {
          acc[customerId].logs.push({
            status: row.interaction_status,
            conversation_metadata: row.conversation_metadata,
            sent_at: row.sent_at ? new Date(row.sent_at) : null,
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

  /**
   * Remove a customer from a campaign (delete mapping only).
   * Allowed only when campaign is in DRAFT state.
   */
  async removeCustomerFromCampaign(
    campaignId: string,
    customerId: string,
    user: User,
  ): Promise<{ success: boolean; message: string }> {
    // Check access
    const campaign = await this.checkCampaignAccess(campaignId, user);

    // Only DRAFT can modify customer list
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException(
        'Chỉ có thể xóa khách hàng khi chiến dịch ở trạng thái bản nháp',
      );
    }

    // Ensure mapping exists
    const mapping = await this.campaignCustomerMapRepository.findOne({
      where: {
        campaign_id: Number(campaignId),
        customer_id: Number(customerId),
      },
    });

    if (!mapping) {
      throw new NotFoundException('Không tìm thấy khách hàng trong chiến dịch');
    }

    // Delete mapping
    await this.campaignCustomerMapRepository.delete({
      campaign_id: Number(campaignId),
      customer_id: Number(customerId),
    });

    return { success: true, message: 'Đã xóa khách hàng khỏi chiến dịch' };
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

  // Load all archived campaigns first (without pagination) to sort properly
  const allRawResults = await qb.getRawMany();

    if (allRawResults.length === 0) {
      const stats = {
        totalCampaigns: 0,
        draftCampaigns: 0,
        runningCampaigns: 0,
        completedCampaigns: 0,
        scheduledCampaigns: 0,
        archivedCampaigns: 0,
      };
      return { data: [], total: 0, stats };
    }

    // Apply pagination after getting all data
    const page = Math.max(1, parseInt(query.page) || 1);
    const pageSize = Math.max(1, parseInt(query.pageSize) || 10);
    const skip = (page - 1) * pageSize;
    const statusOrder: Record<string, number> = {
      scheduled: 1,
      running: 2,
      draft: 3,
      paused: 4,
      completed: 5,
    };
    const sortedAll = allRawResults.sort((a: any, b: any) => {
      const sa = statusOrder[a.campaign_status] ?? 999;
      const sb = statusOrder[b.campaign_status] ?? 999;
      if (sa !== sb) return sa - sb;
      return (
        new Date(b.campaign_created_at).getTime() -
        new Date(a.campaign_created_at).getTime()
      );
    });
    const rawResults = sortedAll.slice(skip, skip + pageSize);

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

    // Process data same as findAll method - use all data for customer mapping
    const allCampaignIds = allRawResults.map((result) => result.campaign_id);
    const campaignIds = rawResults.map((result) => result.campaign_id);

    const allCustomerMaps =
      allCampaignIds.length > 0
        ? await this.campaignCustomerMapRepository
            .createQueryBuilder('map')
            .leftJoinAndSelect('map.campaign_customer', 'customer')
            .where('map.campaign_id IN (:...allCampaignIds)', { allCampaignIds })
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

  // Build page data only
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

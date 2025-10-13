import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DepartmentSchedule,
  ScheduleType,
  ScheduleStatus,
  HourlySlotsConfig,
} from '../campaign_departments_schedules/campaign_departments_schedules.entity';
import { ScheduleCalculatorHelper } from '../campaigns/helpers/schedule-calculator.helper';
import { Campaign, CampaignStatus } from '../campaigns/campaign.entity';
import { CampaignSchedule } from '../campaign_schedules/campaign_schedule.entity';

@Injectable()
export class ScheduleStatusUpdaterService {
  private readonly logger = new Logger(ScheduleStatusUpdaterService.name);

  constructor(
    @InjectRepository(DepartmentSchedule)
    private readonly departmentScheduleRepository: Repository<DepartmentSchedule>,
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(CampaignSchedule)
    private readonly campaignScheduleRepository: Repository<CampaignSchedule>,
  ) {}

  /**
   * Cron mỗi phút: cập nhật status schedules
   * - ACTIVE: đang trong khung giờ, hoặc (hôm nay = applicable_date) cho tới khi qua hết slot của NGÀY đó
   * - INACTIVE: chưa đến giờ / còn occurrence trong tương lai
   * - EXPIRED: không còn occurrence nào nữa
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async updateScheduleStatuses(): Promise<void> {
    try {
      this.logger.debug('Bắt đầu cập nhật schedule statuses...');

      // Lấy tất cả (kể cả INACTIVE) để có thể bật ACTIVE đúng lúc
      const schedules = await this.departmentScheduleRepository.find({
        relations: ['department'],
      });

      let updatedCount = 0;
      const now = new Date();

      for (const schedule of schedules) {
        try {
          const newStatus = this.calculateScheduleStatus(schedule, now);
          if (newStatus !== schedule.status) {
            await this.departmentScheduleRepository.update(schedule.id, { status: newStatus });
            updatedCount++;
            this.logger.log(
              `Updated schedule "${schedule.name}" (ID: ${schedule.id}) from ${schedule.status} to ${newStatus}`,
            );
          }
        } catch (error: any) {
          this.logger.error(`Lỗi khi cập nhật schedule ID ${schedule.id}: ${error.message}`, error.stack);
        }
      }

      if (updatedCount > 0) {
        this.logger.log(`Đã cập nhật ${updatedCount} schedule statuses`);
      } else {
        this.logger.debug('Không có schedule nào cần cập nhật status');
      }
    } catch (error: any) {
      this.logger.error('Lỗi trong quá trình cập nhật schedule statuses:', error.stack);
    }
  }

  /** Chủ nhật 23:59 — reset campaign SCHEDULED không có start_date & end_date về DRAFT */
  @Cron('59 23 * * 0')
  async resetInvalidScheduledCampaigns(): Promise<void> {
    try {
      this.logger.debug('Bắt đầu kiểm tra và reset campaigns SCHEDULED không hợp lệ...');

      const scheduledCampaigns = await this.campaignRepository.find({
        where: { status: CampaignStatus.SCHEDULED },
        relations: ['department'],
      });

      let resetCount = 0;

      for (const campaign of scheduledCampaigns) {
        try {
          const campaignSchedule = await this.campaignScheduleRepository.findOne({
            where: { campaign: { id: campaign.id } },
          });

          if (!campaignSchedule || (!campaignSchedule.start_date && !campaignSchedule.end_date)) {
            await this.campaignRepository.update(campaign.id, { status: CampaignStatus.DRAFT });
            resetCount++;
            this.logger.log(
              `Reset campaign "${campaign.name}" (ID: ${campaign.id}) từ SCHEDULED về DRAFT (không có start_date & end_date)`,
            );
          }
        } catch (error: any) {
          this.logger.error(`Lỗi khi kiểm tra campaign ID ${campaign.id}: ${error.message}`, error.stack);
        }
      }

      if (resetCount > 0) {
        this.logger.log(`Đã reset ${resetCount} campaigns SCHEDULED không hợp lệ về DRAFT`);
      } else {
        this.logger.debug('Không có campaign SCHEDULED nào cần reset');
      }
    } catch (error: any) {
      this.logger.error('Lỗi trong quá trình reset campaigns SCHEDULED không hợp lệ:', error.stack);
    }
  }

  /** ISO DOW: Mon=1..Sun=7 */
  private isoDow(d: Date): number {
    const g = d.getDay(); // Sun=0..Sat=6
    return g === 0 ? 7 : g;
  }

  /** Legacy mapping: Thứ 2..Thứ 7 = 2..7 (Chủ nhật không dùng) */
  private legacyFromIso(iso: number): number | null {
    // Mon..Sat (1..6) => 2..7 ; Sun (7) => null
    if (iso >= 1 && iso <= 6) return iso + 1;
    return null;
  }

  /** Ngược lại: 2..7 (Mon..Sat) => 1..6 (ISO) */
  private isoFromLegacy(legacy: number): number | null {
    if (legacy >= 2 && legacy <= 7) return legacy - 1; // 2..7 -> 1..6
    return null; // Chủ nhật không có mã legacy
  }

  /** So sánh YYYY-MM-DD theo local time */
  private sameYMD(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  /** Parse "YYYY-MM-DD" thành local date lúc 00:00 */
  private parseLocalYMD(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date();
    dt.setFullYear(y, (m ?? 1) - 1, d ?? 1);
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  /** Kết hợp baseDate (local midnight) + HH:mm[:ss] */
  private combine(baseLocalMidnight: Date, time: string): Date {
    const [hh, mm = '0', ss = '0'] = time.split(':');
    const t = new Date(baseLocalMidnight);
    t.setHours(Number(hh), Number(mm), Number(ss), 0);
    return t;
  }

  /**
   * hourly_slots:
   * - applicable_date (one-off):
   *   + Nếu applicable_date ở tương lai: hasFuture = true (=> INACTIVE)
   *   + Nếu applicable_date = hôm nay: **ACTIVE cho tới khi qua hết TẤT CẢ slot của NGÀY**
   *       (kể cả trước slot đầu). Khi now > lastEnd của ngày -> hết ACTIVE (có thể EXPIRED).
   *   + Nếu applicable_date ở quá khứ: chỉ ACTIVE nếu còn slot qua-đêm chưa kết thúc; ngược lại không future.
   *   + Nếu có day_of_week (2..7), validate: phải khớp thứ của CHÍNH applicable_date.
   * - Không có applicable_date nhưng có day_of_week (2..7): weekly recurring Mon..Sat.
   * - Không có cả hai: daily recurring.
   */
  private evaluateHourlySlots(
    cfg: HourlySlotsConfig,
    now: Date,
  ): { activeNow: boolean; hasFuture: boolean } {
    let activeNow = false;
    let hasFuture = false;
    const ONE_DAY = 24 * 60 * 60 * 1000;

    const slots = Array.isArray(cfg?.slots) ? cfg.slots : [];

    // Tính lastEnd của tất cả slot có applicable_date = HÔM NAY
    let todayLastEnd: Date | null = null;
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    for (const slot of slots) {
      const slotDowLegacy: number | null =
        typeof (slot as any).day_of_week === 'number' ? Number((slot as any).day_of_week) : null;

      // 1) Slot theo ngày cụ thể (applicable_date)
      if ((slot as any)?.applicable_date) {
        const base = this.parseLocalYMD((slot as any).applicable_date);

        // Validate day_of_week nếu có (phải khớp thứ của CHÍNH applicable_date)
        if (slotDowLegacy != null) {
          const isoBase = this.isoDow(base);                // 1..7
          const legacyOfBase = this.legacyFromIso(isoBase); // 2..7 hoặc null nếu CN
          if (legacyOfBase == null || legacyOfBase !== slotDowLegacy) {
            // THAY ĐỔI: Thay vì continue, vẫn xử lý slot nhưng log warning
            this.logger.warn(
              `Schedule slot có day_of_week=${slotDowLegacy} không khớp với applicable_date=${(slot as any).applicable_date} (thứ ${legacyOfBase || 'CN'}). Vẫn xử lý slot này.`
            );
            // Không continue, vẫn xử lý slot này để tránh bị đánh dấu EXPIRED sai
          }
        }

        // Tính start/end (xử lý qua đêm)
        let start = this.combine(base, (slot as any).start_time);
        let end = this.combine(base, (slot as any).end_time);
        if (end <= start) end = new Date(end.getTime() + ONE_DAY);

        if (this.sameYMD(base, today)) {
          // HÔM NAY: gom để tính lastEnd; ACTIVE giữ cho tới khi qua hết
          if (!todayLastEnd || end > todayLastEnd) todayLastEnd = end;
        } else if (now < start) {
          // Ngày tương lai
          hasFuture = true;
        } else if (now >= start && now <= end) {
          // Đang chạy (case qua-đêm từ ngày khác)
          activeNow = true;
        }
        // else: đã qua slot one-off đó, không future
        continue;
      }

      // 2) Slot weekly (Mon..Sat) theo legacy 2..7
      if (slotDowLegacy != null) {
        const targetIso = this.isoFromLegacy(slotDowLegacy); // 1..6
        if (targetIso == null) continue; // Chủ nhật không dùng

        const nowISO = this.isoDow(now); // 1..7
        const delta = (targetIso - nowISO + 7) % 7; // 0..6
        const occurDate = new Date(now);
        occurDate.setDate(now.getDate() + delta);
        occurDate.setHours(0, 0, 0, 0);

        let start = this.combine(occurDate, (slot as any).start_time);
        let end = this.combine(occurDate, (slot as any).end_time);
        if (end <= start) end = new Date(end.getTime() + ONE_DAY);

        if (now < start) hasFuture = true;
        else if (now >= start && now <= end) activeNow = true;
        else hasFuture = true; // tuần sau vẫn có
        continue;
      }

      // 3) Fallback: daily recurring
      {
        const occurDate = new Date(now);
        occurDate.setHours(0, 0, 0, 0);

        let start = this.combine(occurDate, (slot as any).start_time);
        let end = this.combine(occurDate, (slot as any).end_time);
        if (end <= start) end = new Date(end.getTime() + ONE_DAY);

        if (now < start) hasFuture = true;
        else if (now >= start && now <= end) activeNow = true;
        else hasFuture = true; // ngày mai
      }
    }

    // Áp quy tắc: HÔM NAY (applicable_date) => ACTIVE cho tới khi qua hết slot của NGÀY
    if (todayLastEnd) {
      if (now <= todayLastEnd) {
        activeNow = true;
      } else {
        // đã qua hết slot của hôm nay -> không set future tại đây (để tổng thể có thể EXPIRED nếu không còn gì khác)
      }
    }

    // BẢO VỆ: Nếu không có hasFuture nhưng có slot với applicable_date ở tương lai
    if (!hasFuture && slots.length > 0) {
      for (const slot of slots) {
        if ((slot as any)?.applicable_date) {
          const base = this.parseLocalYMD((slot as any).applicable_date);
          if (base > today) {
            hasFuture = true;
            this.logger.debug(`Phát hiện slot tương lai bị bỏ qua: ${(slot as any).applicable_date}, đã set hasFuture=true`);
            break;
          }
        }
      }
    }

    return { activeNow, hasFuture };
  }

  private calculateScheduleStatus(
    schedule: DepartmentSchedule,
    currentTime: Date,
  ): ScheduleStatus {
    try {
      if (schedule.schedule_type === ScheduleType.HOURLY_SLOTS) {
        const { activeNow, hasFuture } = this.evaluateHourlySlots(
          schedule.schedule_config as HourlySlotsConfig,
          currentTime,
        );
        if (activeNow) return ScheduleStatus.ACTIVE;
        if (hasFuture) return ScheduleStatus.INACTIVE;
        return ScheduleStatus.EXPIRED;
      }

      // Giữ nguyên cho các loại khác (e.g. DAILY_DATES)
      const isCurrentlyInSchedule = ScheduleCalculatorHelper.isCurrentTimeInSchedule(
        schedule.schedule_config,
        schedule.schedule_type,
        currentTime,
      );
      if (isCurrentlyInSchedule) return ScheduleStatus.ACTIVE;

      const scheduleDetails = ScheduleCalculatorHelper.getScheduleDetails(
        schedule.schedule_config,
        schedule.schedule_type,
      );
      if (scheduleDetails?.endDate && currentTime > scheduleDetails.endDate) {
        return ScheduleStatus.EXPIRED;
      }
      return ScheduleStatus.INACTIVE;
    } catch (e: any) {
      this.logger.warn(`Không thể tính status cho schedule ID ${schedule.id}: ${e.message}`);
      return schedule.status;
    }
  }

  /** Manual trigger: update status */
  async manualUpdateScheduleStatuses(): Promise<{ updated: number; total: number }> {
    this.logger.log('Manual trigger schedule status update...');

    const schedules = await this.departmentScheduleRepository.find({ relations: ['department'] });
    let updatedCount = 0;
    const now = new Date();

    for (const schedule of schedules) {
      const newStatus = this.calculateScheduleStatus(schedule, now);
      if (newStatus !== schedule.status) {
        await this.departmentScheduleRepository.update(schedule.id, { status: newStatus });
        updatedCount++;
      }
    }

    this.logger.log(`Manual update completed: ${updatedCount}/${schedules.length} schedules updated`);
    return { updated: updatedCount, total: schedules.length };
  }

  /** Manual trigger: reset scheduled campaigns invalid */
  async manualResetInvalidScheduledCampaigns(): Promise<{ reset: number; total: number }> {
    this.logger.log('Manual trigger reset invalid scheduled campaigns...');

    const scheduledCampaigns = await this.campaignRepository.find({
      where: { status: CampaignStatus.SCHEDULED },
      relations: ['department'],
    });

    let resetCount = 0;

    for (const campaign of scheduledCampaigns) {
      const campaignSchedule = await this.campaignScheduleRepository.findOne({
        where: { campaign: { id: campaign.id } },
      });

      if (!campaignSchedule || (!campaignSchedule.start_date && !campaignSchedule.end_date)) {
        await this.campaignRepository.update(campaign.id, { status: CampaignStatus.DRAFT });
        resetCount++;
      }
    }

    this.logger.log(`Manual reset completed: ${resetCount}/${scheduledCampaigns.length} campaigns reset`);
    return { reset: resetCount, total: scheduledCampaigns.length };
  }

  /** Thống kê status */
  async getScheduleStatusStats(): Promise<{ active: number; inactive: number; expired: number; total: number }> {
    const [active, inactive, expired, total] = await Promise.all([
      this.departmentScheduleRepository.count({ where: { status: ScheduleStatus.ACTIVE } }),
      this.departmentScheduleRepository.count({ where: { status: ScheduleStatus.INACTIVE } }),
      this.departmentScheduleRepository.count({ where: { status: ScheduleStatus.EXPIRED } }),
      this.departmentScheduleRepository.count(),
    ]);
    return { active, inactive, expired, total };
  }
}

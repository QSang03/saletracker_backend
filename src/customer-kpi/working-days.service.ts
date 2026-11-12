import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SystemConfig } from '../system_config/system_config.entity';
import { shiftDateStr } from './vn-date';

const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const MINUTES_PER_DAY = 24 * 60;

interface StopInterval {
  start: number;
  end: number;
}

interface WorkingCalendar {
  /** Khoảng dừng theo thứ, đơn vị phút từ 00:00. */
  stopWindows: Record<string, StopInterval[]>;
  holidays: Set<string>;
  loadedAt: number;
}

/**
 * Đếm ngày làm việc cho `daily-tracking`.
 *
 * Nguồn cấu hình giữ nguyên của hệ thống:
 *   - `system_stopToolConfig`: các khoảng DỪNG theo thứ (phần còn lại là giờ làm);
 *   - `holiday_single_day` / `holiday_multi_days` / `holiday_separated_days`:
 *     mảng group có `dates: string[]`.
 *
 * Chỉ cần biết một ngày có làm việc hay không (không cần số giờ), nên logic
 * đơn giản hơn WorkingCalendar của Python: một ngày làm việc khi tổng các
 * khoảng dừng (kể cả đuôi qua đêm của hôm trước) nhỏ hơn 24h và không phải
 * ngày lễ.
 *
 * Không tái sử dụng cho SLA KPI customer: SLA có calendar riêng (xuyên trưa,
 * blackout 23:00–08:00) — xem kế hoạch mục 3.7.
 */
@Injectable()
export class WorkingDaysService {
  /** Cache 60 giây — config ít đổi, tránh query DB mỗi lần gọi API. */
  private calendarCache: WorkingCalendar | null = null;

  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepo: Repository<SystemConfig>,
  ) {}

  private parseMaybeJson(value: unknown): unknown {
    let current = value;
    for (let i = 0; i < 2; i += 1) {
      if (typeof current !== 'string') return current;
      try {
        current = JSON.parse(current);
      } catch {
        return null;
      }
    }
    return current;
  }

  private parseHhMm(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  private async loadCalendar(): Promise<WorkingCalendar> {
    if (
      this.calendarCache &&
      Date.now() - this.calendarCache.loadedAt < 60_000
    ) {
      return this.calendarCache;
    }

    const configs = await this.configRepo.find({
      where: {
        name: In([
          'system_stopToolConfig',
          'holiday_single_day',
          'holiday_multi_days',
          'holiday_separated_days',
        ]),
      },
    });

    const stopWindows: Record<string, StopInterval[]> = {};
    const holidays = new Set<string>();

    for (const cfg of configs) {
      const parsed = this.parseMaybeJson(cfg.value);
      if (cfg.name === 'system_stopToolConfig') {
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          continue;
        }
        for (const key of WEEKDAY_KEYS) {
          const rawItems = (parsed as Record<string, unknown>)[key];
          if (!Array.isArray(rawItems)) continue;
          const items: StopInterval[] = [];
          for (const raw of rawItems) {
            if (!raw || typeof raw !== 'object') continue;
            const rawObj = raw as Record<string, unknown>;
            const start = this.parseHhMm(rawObj.start);
            const end = this.parseHhMm(rawObj.end);
            if (start == null || end == null) continue;
            // "23:59" nghĩa là tới hết ngày (giống Python WorkingCalendar).
            items.push({
              start,
              end: end >= MINUTES_PER_DAY - 1 ? MINUTES_PER_DAY : end,
            });
          }
          if (items.length > 0) stopWindows[key] = items;
        }
        continue;
      }

      // 3 config ngày lễ: [{ dates: ["YYYY-MM-DD", ...] }, ...]
      if (!Array.isArray(parsed)) continue;
      for (const group of parsed) {
        if (!group || typeof group !== 'object') continue;
        const dates = (group as Record<string, unknown>).dates;
        if (!Array.isArray(dates)) continue;
        for (const date of dates) {
          if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            holidays.add(date);
          }
        }
      }
    }

    this.calendarCache = {
      stopWindows,
      holidays,
      loadedAt: Date.now(),
    };
    return this.calendarCache;
  }

  private weekdayKey(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    return WEEKDAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  }

  private previousWeekdayKey(date: string): string {
    return this.weekdayKey(shiftDateStr(date, -1));
  }

  private mergeIntervals(intervals: StopInterval[]): StopInterval[] {
    if (intervals.length === 0) return [];
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    const merged: StopInterval[] = [{ ...sorted[0] }];
    for (const item of sorted.slice(1)) {
      const last = merged[merged.length - 1];
      if (item.start <= last.end) {
        last.end = Math.max(last.end, item.end);
      } else {
        merged.push({ ...item });
      }
    }
    return merged;
  }

  /**
   * Một ngày làm việc khi còn ít nhất 1 phút không bị dừng.
   * Có tính đuôi qua đêm của ngày hôm trước (start > end).
   */
  private isWorkingDay(date: string, calendar: WorkingCalendar): boolean {
    if (calendar.holidays.has(date)) return false;
    const dayKey = this.weekdayKey(date);
    const prevKey = this.previousWeekdayKey(date);
    const intervals: StopInterval[] = [];

    for (const item of calendar.stopWindows[dayKey] ?? []) {
      if (item.start < item.end) {
        intervals.push({ start: item.start, end: item.end });
      } else if (item.start > item.end) {
        // Qua đêm: phần trong ngày hôm nay + phần đuôi sang ngày mai.
        intervals.push({ start: item.start, end: MINUTES_PER_DAY });
      }
    }
    for (const item of calendar.stopWindows[prevKey] ?? []) {
      if (item.start > item.end) {
        intervals.push({ start: 0, end: item.end });
      }
    }

    const merged = this.mergeIntervals(intervals);
    const stopped = merged.reduce(
      (total, item) => total + (item.end - item.start),
      0,
    );
    return stopped < MINUTES_PER_DAY;
  }

  /** Số ngày làm việc trong [from, to], tính cả hai đầu. */
  async countWorkingDays(from: string, to: string): Promise<number> {
    if (!from || !to || from > to) return 0;
    const calendar = await this.loadCalendar();
    let count = 0;
    let cursor = from;
    while (cursor <= to) {
      if (this.isWorkingDay(cursor, calendar)) count += 1;
      cursor = shiftDateStr(cursor, 1);
    }
    return count;
  }

  async isWorkingDayFor(date: string): Promise<boolean> {
    const calendar = await this.loadCalendar();
    return this.isWorkingDay(date, calendar);
  }

  /** Xoá cache — dùng cho test hoặc sau khi admin sửa config. */
  clearCache(): void {
    this.calendarCache = null;
  }
}

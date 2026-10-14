import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NkmSyncService } from './nkm-sync.service';
import { vnToday, shiftDateStr } from './vn-date';

/**
 * Cron đồng bộ dữ liệu API NKM (thiết kế §4). Ba việc, ba lịch:
 *
 *   00:30 mỗi ngày   chốt doanh thu HÔM QUA + gọi bù ngày hụt (tối đa 30 ngày)
 *   08/11/14/17/20   chốt số liệu TỔM TẠI của hôm nay (SAP còn nạp dở, số còn
 *                    nhảy) — báo cáo hiện kèm nhãn "tạm tính"
 *   06:00 mỗi ngày   chỉ tiêu + thực tế theo quý (API quý cache ~6 tiếng)
 *
 * Vì sao KHÔNG chốt hôm nay lúc 00:30: dữ liệu trong ngày chưa ổn định (đã
 * kiểm chứng: cùng một URL gọi cách vài phút ra 41 rồi 139 dòng), nên ngày hôm
 * nay chỉ được làm mới lại vài lần trong ngày, ngày đã qua mới coi là chốt.
 *
 * Cấu hình qua env (giống cron gợi ý):
 *   CUSTOMER_NKM_REVENUE_CRON    — lịch đồng bộ ngày (mặc định '30 0 * * *')
 *   CUSTOMER_NKM_TODAY_CRON      — lịch chốt số tạm của hôm nay
 *   CUSTOMER_NKM_QUARTER_CRON    — lịch đồng bộ chỉ tiêu quý (mặc định '0 6 * * *')
 *   CUSTOMER_NKM_ENABLED         — 'false' để tắt toàn bộ
 */
@Injectable()
export class NkmSyncCronjob {
  private readonly logger = new Logger(NkmSyncCronjob.name);
  private running = new Set<string>();

  /** Ngày lùi về trước để soi hụt — chỉ bù tối đa 30 ngày như thiết kế. */
  private static readonly BACKFILL_LOOKBACK = 29;

  constructor(private readonly syncService: NkmSyncService) {}

  /** Chỉ một lần chạy cho mỗi việc — lần trước chưa xong thì bỏ qua. */
  private async runGuard(key: string, task: () => Promise<void>) {
    if (this.running.has(key)) {
      this.logger.warn(
        `Lần chạy trước (${key}) chưa xong, bỏ qua để tránh chồng lấn`,
      );
      return;
    }
    this.running.add(key);
    try {
      await task();
    } catch (error: any) {
      this.logger.error(`Đồng bộ ${key} thất bại: ${error?.message}`);
    } finally {
      this.running.delete(key);
    }
  }

  @Cron(process.env.CUSTOMER_NKM_REVENUE_CRON || '30 0 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async syncYesterdayRevenue() {
    if (process.env.CUSTOMER_NKM_ENABLED === 'false') return;
    await this.runGuard('revenue/day', async () => {
      const yesterday = shiftDateStr(vnToday(), -1);
      await this.syncService.syncRevenueDay(yesterday);
      const from = shiftDateStr(yesterday, -NkmSyncCronjob.BACKFILL_LOOKBACK);
      const missing = await this.syncService.findMissingDays(from, yesterday);
      for (const day of missing) {
        this.logger.log(`Gọi bù dữ liệu ngày ${day}`);
        await this.syncService.syncRevenueDay(day);
      }
    });
  }

  @Cron(process.env.CUSTOMER_NKM_TODAY_CRON || '0 8,11,14,17,20 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async syncTodayRevenue() {
    if (process.env.CUSTOMER_NKM_ENABLED === 'false') return;
    await this.runGuard('revenue/today', async () => {
      await this.syncService.syncRevenueDay(vnToday());
    });
  }

  @Cron(process.env.CUSTOMER_NKM_QUARTER_CRON || '0 6 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async syncQuarterTargets() {
    if (process.env.CUSTOMER_NKM_ENABLED === 'false') return;
    await this.runGuard('revenue/quarter', async () => {
      await this.syncService.syncQuarterTargets();
    });
  }
}

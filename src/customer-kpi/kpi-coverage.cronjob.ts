import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KpiCoverageService } from './kpi-coverage.service';

/**
 * Cron chốt KPI tháng/quý.
 *
 * - Tháng: 00:30 ngày 1 mỗi tháng, chốt tháng trước (snapshot, không ghi đè
 *   nếu đã có kết quả).
 * - Quý: 00:30 các ngày 1-10/01, 04, 07, 10 — S1 có thể còn điều chỉnh dữ
 *   liệu trong 10 ngày đầu quý sau. Service tự bỏ qua settlement đã final.
 */
@Injectable()
export class KpiCoverageCronjob {
  private readonly logger = new Logger(KpiCoverageCronjob.name);

  constructor(private readonly coverage: KpiCoverageService) {}

  private logError(label: string, error: unknown): void {
    const err = error as { message?: string; stack?: string } | null;
    this.logger.error(`${label}: ${err?.message ?? String(error)}`, err?.stack);
  }

  @Cron('30 0 1 * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async runMonthly(): Promise<void> {
    try {
      await this.coverage.runMonthlyCron();
    } catch (error: unknown) {
      this.logError('Cron KPI tháng lỗi', error);
    }
  }

  @Cron('30 0 1-10 1,4,7,10 *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async runQuarter(): Promise<void> {
    try {
      await this.coverage.runQuarterCron();
    } catch (error: unknown) {
      this.logError('Cron KPI quý lỗi', error);
    }
  }
}

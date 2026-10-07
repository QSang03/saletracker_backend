import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../notifications/notification.entity';
import { CustomerKpiReportsService } from './customer-kpi-reports.service';

/**
 * Cron "Mỗi sáng gợi ý cho từng Sale: hôm nay nên liên lạc khách nào"
 * (Mục 4, cv 5) — 07:00 giờ VN mỗi ngày, tính gợi ý cho TOÀN BỘ sale rồi
 * đẩy vào bảng notifications (chuông FE).
 *
 * Nội dung dùng cùng pipeline với GET /customer-kpi-reports/suggestions nên
 * màn hình và thông báo không bao giờ lệch nhau.
 *
 * Cấu hình qua env:
 * - CUSTOMER_SUGGESTIONS_CRON    — biểu thức cron (mặc định '0 7 * * *')
 * - CUSTOMER_SUGGESTIONS_ENABLED — đặt 'false' để tắt (mặc định bật)
 */
@Injectable()
export class CustomerSuggestionsCronjob {
  private readonly logger = new Logger(CustomerSuggestionsCronjob.name);
  private isRunning = false;

  constructor(
    private readonly reportsService: CustomerKpiReportsService,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
  ) {}

  @Cron(process.env.CUSTOMER_SUGGESTIONS_CRON || '0 7 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async pushDailySuggestions() {
    if (process.env.CUSTOMER_SUGGESTIONS_ENABLED === 'false') return;
    if (this.isRunning) {
      this.logger.warn('Lần chạy trước chưa xong, bỏ qua để tránh gửi trùng');
      return;
    }
    this.isRunning = true;
    try {
      const { date, sales } =
        await this.reportsService.suggestionsForAllSales();
      let notified = 0;
      for (const sale of sales) {
        const title = `Gợi ý liên lạc hôm nay (${date})`;
        // Restart giữa ngày không được gửi lặp — tiêu đề có ngày nên tra được
        const exists = await this.notificationRepo.count({
          where: { user: { id: sale.saleId }, title },
        });
        if (exists > 0) continue;

        const lines = sale.suggestions.map(
          (s, i) =>
            `${i + 1}. [${s.customerTier ?? '?'}] ${s.customerCode} — ${s.customerName} (${s.reasonText})`,
        );
        const content = [
          `Hôm nay bạn nên liên lạc ${sale.suggestions.length} khách hàng:`,
          '',
          ...lines,
          '',
          'Xem chi tiết: báo cáo KPI → Gợi ý thực hiện.',
        ].join('\n');

        await this.notificationRepo.save(
          this.notificationRepo.create({
            user: { id: sale.saleId } as any,
            title,
            content,
          }),
        );
        notified++;
      }
      this.logger.log(
        `Đã đẩy gợi ý sáng cho ${notified}/${sales.length} sale (ngày ${date})`,
      );
    } catch (error: any) {
      this.logger.error(`Cron gợi ý buổi sáng thất bại: ${error?.message}`);
    } finally {
      this.isRunning = false;
    }
  }
}

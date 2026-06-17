import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class CronjobService {
  private readonly logger = new Logger(CronjobService.name);

  constructor() {
    this.logger.log(
      '🎯 [CronjobService] Service chính đã được khởi tạo - Các cronjob riêng biệt sẽ được xử lý bởi các service chuyên biệt',
    );
  }

  /**
   * Method để lấy thông tin về tất cả cronjob services
   */
  getCronjobInfo(): string[] {
    return [
      'DebtStatisticsCronjobService: Backup thống kê công nợ hàng ngày lúc 23h',
      'DebtHistoriesCronjobService: Clone debt logs sang histories và reset lúc 23h',
      'DatabaseCleanupCronjobService: Dọn dẹp database change log theo batch lúc 23h',
      'OrderCleanupCronjobService: Ẩn order details hết hạn hoặc gia hạn extended lúc 01h',
      'CampaignCleanupCronjobService: Dọn dẹp các chiến dịch cũ (3 tháng) và dữ liệu liên quan lúc 02h sáng',
    ];
  }
}

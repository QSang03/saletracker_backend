import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderDetail } from '../order-details/order-detail.entity';
import { WinstonLogger } from '../common/winston.logger';

/**
 * Tính lại thống kê (statistics) của InnoDB cho các bảng lớn/chuyển động mạnh.
 *
 * Vì sao cần: MySQL chọn index dựa trên thống kê lấy mẫu (mặc định 20 pages/index).
 * Với order_details (~630k rows, ~97% đã ẩn), thống kê có thể lệch 2x so với
 * thực tế (đo thấy: ước 295k rows cho deleted_at IS NULL, thực 615k) khiến
 * optimizer thỉnh thoảng chọn nhầm index → query 2-3s thay vì ~200ms.
 * innodb_stats_auto_recalc chỉ kích hoạt khi >10% rows thay đổi và chạy ngẫu
 * nhiên thời điểm, nên lỗi "lúc nhanh lúc chậm" khó tái hiện. ANALYZE TABLE ép
 * tính lại NGAY, chủ động, giúp optimizer luôn có số liệu tươi.
 *
 * An toàn: ANALYZE TABLE không đổi dữ liệu (chỉ đọc mẫu + cập nhật bảng thống
 * kê), InnoDB chạy online không khóa đọc/ghi. Chi phí ~vài trăm ms/bảng.
 * Đặt lịch giờ thấp điểm (2:30 sáng) chỉ để tránh trùng transaction dài có thể
 * chờ metadata lock trong chốc lát.
 *
 * Danh sách bảng lấy từ env CRON_ANALYZE_TABLES (CSV, chỉ nhận [A-Za-z0-9_]),
 * mặc định: order_details, orders, users, products, departments.
 * Lịch chạy: env CRON_DB_ANALYZE_TIME, mặc định 02:30 sáng hằng ngày (giờ VN).
 */
@Injectable()
export class DbAnalyzeCronjobService {
  private readonly logger = new WinstonLogger(DbAnalyzeCronjobService.name);

  constructor(
    @InjectRepository(OrderDetail)
    private readonly orderDetailRepository: Repository<OrderDetail>,
  ) {
    this.logger.log(
      '🎯 [DbAnalyzeCronjobService] Service đã được khởi tạo - Cronjob ANALYZE TABLE sẽ chạy lúc 02h30 sáng hàng ngày (giờ Việt Nam)',
    );
  }

  @Cron(process.env.CRON_DB_ANALYZE_TIME || '30 2 * * *', {
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async analyzeTableStatistics() {
    const vietnamTime = new Date().toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    this.logger.log(
      `🔄 [DB Analyze Cron] Bắt đầu tính lại thống kê các bảng lúc ${vietnamTime}`,
    );

    const tables = (process.env.CRON_ANALYZE_TABLES || 'order_details,orders,users,products,departments')
      .split(',')
      .map((t) => t.trim())
      // Chỉ nhận tên bảng hợp lệ để tránh SQL injection qua env
      .filter((t) => /^[A-Za-z0-9_]+$/.test(t));

    if (tables.length === 0) {
      this.logger.warn(
        '⚠️ [DB Analyze Cron] CRON_ANALYZE_TABLES không chứa bảng hợp lệ nào, bỏ qua lượt chạy',
      );
      return;
    }

    let success = 0;
    let failed = 0;
    const startedAt = Date.now();

    for (const table of tables) {
      const t0 = Date.now();
      try {
        await this.orderDetailRepository.query(`ANALYZE TABLE \`${table}\``);
        success++;
        this.logger.log(
          `✅ [DB Analyze Cron] ANALYZE TABLE ${table} xong trong ${Date.now() - t0}ms`,
        );
      } catch (error) {
        failed++;
        this.logger.error(
          `❌ [DB Analyze Cron] ANALYZE TABLE ${table} lỗi sau ${Date.now() - t0}ms: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    this.logger.log(
      `🏁 [DB Analyze Cron] Hoàn thành ${success}/${tables.length} bảng (lỗi: ${failed}) trong ${Date.now() - startedAt}ms`,
    );
  }
}

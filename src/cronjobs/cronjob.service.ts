import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NKCProduct } from '../nkc_products/nkc_product.entity';
import { Category } from '../categories/category.entity';
import { DebtStatistic } from '../debt_statistics/debt_statistic.entity';
import { Debt } from '../debts/debt.entity';
import { DebtHistory } from 'src/debt_histories/debt_histories.entity';
import { DatabaseChangeLog } from 'src/observers/change_log.entity';

@Injectable()
export class CronjobService {
  private readonly logger = new Logger(CronjobService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    @InjectRepository(NKCProduct)
    private readonly nkcProductRepo: Repository<NKCProduct>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(DebtStatistic)
    private debtStatisticRepo: Repository<DebtStatistic>,
    @InjectRepository(Debt)
    private debtRepo: Repository<Debt>,
    @InjectRepository(DebtHistory)
    private debtHistoryRepo: Repository<DebtHistory>,
    @InjectRepository(DatabaseChangeLog)
    private changeLogRepo: Repository<DatabaseChangeLog>,
  ) {
    this.logger.log(
      '🎯 [CronjobService] Service đã được khởi tạo - Cronjob debt statistics sẽ chạy lúc 11h trưa hàng ngày',
    );
  }

  @Cron(process.env.CRON_DEBT_STATISTICS_TIME || '0 23 * * *')
  async handleDebtStatisticsCron() {
    // Sử dụng timezone Việt Nam (UTC+7)
    const today = new Date();
    const vietnamTime = new Date(today.getTime() + 7 * 60 * 60 * 1000); // Add 7 hours
    const todayStr = vietnamTime.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    const vietnamDate = new Date(todayStr); // Parse as date for comparison

    this.logger.log(
      `🔄 [Auto Cron] Bắt đầu capture debt statistics cho ngày: ${todayStr}`,
    );

    try {
      // Kiểm tra đã có data cho ngày hôm nay chưa
      const existingCount = await this.debtStatisticRepo.count({
        where: { statistic_date: vietnamDate },
      });

      if (existingCount > 0) {
        this.logger.log(
          `⚠️ [Auto Cron] Đã có ${existingCount} bản ghi cho ngày ${todayStr}, bỏ qua`,
        );
        return;
      }

      // Raw query để copy ALL debts sang debt_statistics mỗi ngày
      // QUAN TRỌNG: Duplicate tất cả phiếu để có thống kê chính xác
      const query = `
        INSERT INTO debt_statistics (
          statistic_date, customer_raw_code, invoice_code, bill_code,
          total_amount, remaining, issue_date, due_date, pay_later,
          status, sale_id, sale_name_raw, employee_code_raw,
          debt_config_id, customer_code, customer_name, note,
          is_notified, original_created_at, original_updated_at, original_debt_id
        )
        SELECT 
          DATE(d.updated_at) as statistic_date,
          d.customer_raw_code, d.invoice_code, d.bill_code,
          d.total_amount, d.remaining, d.issue_date, d.due_date, d.pay_later,
          d.status, d.sale_id, d.sale_name_raw, d.employee_code_raw,
          d.debt_config_id, dc.customer_code, dc.customer_name, d.note,
          d.is_notified, d.created_at, d.updated_at, d.id
        FROM debts d
        LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
        WHERE d.deleted_at IS NULL
        AND DATE(d.updated_at) = ?
      `;

      const result = await this.debtStatisticRepo.query(query, [todayStr]);

      this.logger.log(
        `✅ [Auto Cron] Đã lưu ${result.affectedRows || 0} bản ghi cho ngày ${todayStr}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ [Auto Cron] Lỗi khi capture debt statistics:`,
        error,
      );
    }
  }

  // Method để chạy thủ công - có thể chạy bất cứ khi nào
  async captureDebtStatisticsManual(targetDate?: string) {
    const dateToCapture = targetDate || new Date().toISOString().split('T')[0];
    const captureDate = new Date(dateToCapture);
    captureDate.setHours(0, 0, 0, 0);

    this.logger.log(
      `🔄 [Thống kê công nợ - Thủ công] Bắt đầu capture cho ngày: ${dateToCapture}`,
    );

    try {
      // Kiểm tra đã có data cho ngày này chưa
      const existingCount = await this.debtStatisticRepo.count({
        where: { statistic_date: captureDate },
      });

      if (existingCount > 0) {
        this.logger.log(
          `⚠️ [Thống kê công nợ - Thủ công] Đã có ${existingCount} bản ghi cho ngày ${dateToCapture}`,
        );
        return {
          success: false,
          message: `Đã có dữ liệu thống kê cho ngày ${dateToCapture}`,
          existingRecords: existingCount,
        };
      }

      const query = `
        INSERT INTO debt_statistics (
          statistic_date, customer_raw_code, invoice_code, bill_code,
          total_amount, remaining, issue_date, due_date, pay_later,
          status, sale_id, sale_name_raw, employee_code_raw,
          debt_config_id, customer_code, customer_name, note,
          is_notified, original_created_at, original_updated_at, original_debt_id
        )
        SELECT 
          DATE(d.created_at) as statistic_date,
          d.customer_raw_code, d.invoice_code, d.bill_code,
          d.total_amount, d.remaining, d.issue_date, d.due_date, d.pay_later,
          d.status, d.sale_id, d.sale_name_raw, d.employee_code_raw,
          d.debt_config_id, dc.customer_code, dc.customer_name, d.note,
          d.is_notified, d.created_at, d.updated_at, d.id
        FROM debts d
        LEFT JOIN debt_configs dc ON d.debt_config_id = dc.id
        WHERE d.deleted_at IS NULL
        AND DATE(d.created_at) = ?
      `;

      this.logger.log(
        `💾 [Thống kê công nợ - Thủ công] Đang capture debts được tạo ngày ${dateToCapture}...`,
      );

      const result = await this.debtStatisticRepo.query(query, [dateToCapture]);

      this.logger.log(
        `✅ [Thống kê công nợ - Thủ công] Đã lưu ${result.affectedRows || 0} bản ghi cho ngày ${dateToCapture}`,
      );

      return {
        success: true,
        message: `Capture thành công ${result.affectedRows || 0} debt statistics`,
        recordsSaved: result.affectedRows || 0,
        date: dateToCapture,
        note: 'Sử dụng ngày tạo debt làm statistic_date',
      };
    } catch (error) {
      this.logger.error(
        `❌ [Thống kê công nợ - Thủ công] Lỗi khi capture debt statistics:`,
        error,
      );
      return {
        success: false,
        message: `Lỗi khi capture debt statistics: ${error.message}`,
        error: error.message,
      };
    }
  }

  @Cron(process.env.CRON_PRODUCT_TIME || '0 2 * * *')
  async fetchAndSaveProducts() {
    const baseUrl = process.env.VNK_API_PRODUCT_URL!;
    const perPage = Number(process.env.VNK_API_PRODUCT_PER_PAGE) || 500;
    const token = this.configService.get<string>('VNK_API_TOKEN')!;
    const concurrency = 5;

    this.logger.log(`[ProductSync] Start product sync...`);

    // Lấy sản phẩm từ API
    const allProducts: any[] = [];
    const apiIds = new Set<number>();
    let page = 1;
    let done = false;
    while (!done) {
      const pages = Array.from({ length: concurrency }, (_, idx) => page + idx);
      const results = await Promise.all(
        pages.map((p) => this.fetchPage(baseUrl, token, perPage, p)),
      );
      for (const [idx, products] of results.entries()) {
        if (!products.length) {
          done = true;
          break;
        }
        allProducts.push(...products);
        products.forEach((item) => apiIds.add(item.product_id));
      }
      page += concurrency;
    }
    this.logger.log(`[ProductSync] Fetched ${allProducts.length} products.`);

    // Upsert sản phẩm mới/cập nhật
    const upsertBatch = allProducts.map((item) => ({
      id: item.product_id,
      productCode: item.MaHH,
      productName: item.TenHH,
      properties: item.properties,
      deletedAt: undefined,
    }));
    await this.nkcProductRepo.upsert(upsertBatch, ['id']);
    this.logger.log(`[ProductSync] Upserted ${upsertBatch.length} products.`);

    // XÓA MỀM: Đánh dấu deletedAt cho sản phẩm không còn trong API
    const deleteBatchSize = 1000;
    let dbOffset = 0;
    let hasMore = true;
    let deletedCount = 0;
    while (hasMore) {
      const dbProducts = await this.nkcProductRepo.find({
        select: ['id'],
        skip: dbOffset,
        take: deleteBatchSize,
      });
      if (!dbProducts.length) break;
      for (const dbProduct of dbProducts) {
        if (!apiIds.has(dbProduct.id)) {
          await this.nkcProductRepo.update(dbProduct.id, {
            deletedAt: new Date(),
          });
          deletedCount++;
        }
      }
      dbOffset += deleteBatchSize;
      hasMore = dbProducts.length === deleteBatchSize;
    }
    this.logger.log(
      `[ProductSync] Soft-deleted ${deletedCount} products not found in API.`,
    );
    this.logger.log(`[ProductSync] Product sync completed.`);
  }

  // Hàm lấy 1 trang sản phẩm
  private async fetchPage(
    baseUrl: string,
    token: string,
    perPage: number,
    page: number,
  ) {
    const url = `${baseUrl}?search=&per_page=${perPage}&page=${page}`;
    try {
      const res = await firstValueFrom(
        this.httpService.get(url, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      return res.data?.data?.data || [];
    } catch (error) {
      this.logger.error(
        `[ProductSync] Error fetching page ${page}: ${error.message}`,
      );
      return [];
    }
  }

  @Cron(process.env.CRON_CATEGORY_TIME || '0 3 * * *') // thời gian lấy từ env
  async fetchAndSaveCategories() {
    const url = this.configService.get<string>('VNK_API_CATEGORY_URL')!;
    const token = this.configService.get<string>('VNK_API_TOKEN')!;
    const response = await firstValueFrom(
      this.httpService.get(url, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    const categories: any[] = response.data?.data || [];
    type FlatCategory = { id: number; catName: string; parent: number | null };
    const flatCategories: FlatCategory[] = [];
    function flatten(cat: any, parentId: number | null = null) {
      flatCategories.push({
        id: cat.cat_id,
        catName: cat.cat_name,
        parent: parentId,
      });
      if (cat.children && Array.isArray(cat.children)) {
        for (const child of cat.children) {
          flatten(child, cat.cat_id);
        }
      }
    }
    for (const cat of categories) {
      flatten(cat, null);
    }
    const apiIds = flatCategories.map((c) => c.id);
    for (const cat of flatCategories) {
      await this.categoryRepo.upsert(
        {
          id: cat.id,
          catName: cat.catName,
          deletedAt: undefined,
          parent: cat.parent ? { id: cat.parent } : undefined,
        },
        ['id'],
      );
    }
    // Batch check for deleted
    const batchSize = 1000;
    let deletedCatCount = 0;
    let dbOffset = 0;
    let hasMore = true;
    while (hasMore) {
      const dbCats = await this.categoryRepo.find({
        select: ['id'],
        skip: dbOffset,
        take: batchSize,
      });
      if (!dbCats.length) break;
      for (const dbCat of dbCats) {
        if (!apiIds.includes(dbCat.id)) {
          await this.categoryRepo.update(dbCat.id, { deletedAt: new Date() });
          deletedCatCount++;
        }
      }
      dbOffset += batchSize;
      hasMore = dbCats.length === batchSize;
    }
    this.logger.log(
      `Hoàn tất đồng bộ danh mục. Đã lưu ${flatCategories.length} danh mục, đánh dấu xóa ${deletedCatCount} danh mục không còn trong API.`,
    );
  }

  @Cron(process.env.CRON_CLONE_DEBT_LOGS_TIME || '0 23 * * *')
  async cloneDebtLogsToHistories() {
    // Dùng ngày hôm qua theo múi giờ VN
    const now = new Date();
    const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const vnTodayStr = vnNow.toISOString().split('T')[0];
    const vnYesterday = new Date(vnNow);
    vnYesterday.setDate(vnYesterday.getDate() - 1);
    const targetDateStr = vnYesterday.toISOString().split('T')[0]; // YYYY-MM-DD (hôm qua)

    this.logger.log(
      `[CRON] Bắt đầu clone debt_logs sang debt_histories cho ngày ${targetDateStr}`,
    );

    // Ghi nhận bản ghi theo ngày gửi (send_at) theo múi giờ VN và idempotent theo từng ngày
    const query = `
  INSERT INTO debt_histories (
    debt_log_id, debt_msg, send_at, user_name, full_name, first_remind, error_msg,
    first_remind_at, second_remind, second_remind_at, sale_msg, conv_id, debt_img,
    remind_status, gender, created_at
  )
  SELECT
    dl.id, dl.debt_msg, dl.send_at, u.username AS user_name, u.full_name,
    dl.first_remind, dl.error_msg, dl.first_remind_at, dl.second_remind,
    dl.second_remind_at, dl.sale_msg, dl.conv_id, dl.debt_img,
    dl.remind_status, dl.gender, NOW()
  FROM debt_logs dl
  LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
  LEFT JOIN users u ON dc.employee_id = u.id
  WHERE DATE(CONVERT_TZ(dl.send_at, '+00:00', '+07:00')) = ?
    AND NOT EXISTS (
      SELECT 1 FROM debt_histories dh
      WHERE dh.debt_log_id = dl.id AND DATE(dh.created_at) = ?
    )
`;
    const result = await this.debtHistoryRepo.query(query, [targetDateStr, targetDateStr]);

    this.logger.log(
      `[CRON] Đã clone xong debt_logs sang debt_histories cho ngày ${targetDateStr}`,
    );
    this.logger.debug(`[CRON] Query result: ${JSON.stringify(result)}`);
  }

  @Cron(process.env.CRON_DEL_DB_CHANGELOGS_TIME || '0 23 * * *')
  async clearDatabaseChangeLog() {
    const now = new Date();
    const vietnamHour = now.getUTCHours() + 7;
    if (vietnamHour !== 11) return;

    this.logger.log('[CRON] Bắt đầu xóa toàn bộ bảng database_change_log');
    try {
      await this.changeLogRepo.clear();
      this.logger.log(
        '[CRON] Đã xóa toàn bộ bảng database_change_log thành công',
      );
    } catch (error) {
      this.logger.error('[CRON] Lỗi khi xóa bảng database_change_log:', error);
    }
  }

  @Cron(process.env.CRON_DEBT_LOGS_TIME || '0 23 * * *')
  async snapshotAndResetDebtLogs() {
    // Dùng snapshot cho ngày hôm qua theo múi giờ VN
    const now = new Date();
    const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const vnTodayStr = vnNow.toISOString().split('T')[0];
    const vnYesterday = new Date(vnNow);
    vnYesterday.setDate(vnYesterday.getDate() - 1);
    const targetDateStr = vnYesterday.toISOString().split('T')[0]; // YYYY-MM-DD hôm qua

    // 1. Snapshot các bản ghi debt_logs theo ngày gửi (send_at) đúng 1 ngày (hôm qua)
    const insertQuery = `
    INSERT INTO debt_histories (
      created_at, remind_status, gender, debt_log_id, send_at, first_remind_at, second_remind_at,
      conv_id, debt_img, sale_msg, second_remind, debt_msg, first_remind, error_msg, user_name, full_name
    )
    SELECT
      NOW(), dl.remind_status, dl.gender, dl.id, dl.send_at, dl.first_remind_at, dl.second_remind_at,
      dl.conv_id, dl.debt_img, dl.sale_msg, dl.second_remind,
      IFNULL(dl.debt_msg, ''), dl.first_remind, dl.error_msg, u.username, u.full_name
    FROM debt_logs dl
    LEFT JOIN debt_configs dc ON dl.debt_config_id = dc.id
    LEFT JOIN users u ON dc.employee_id = u.id
    WHERE DATE(CONVERT_TZ(dl.send_at, '+00:00', '+07:00')) = ?
      AND NOT EXISTS (
        SELECT 1 FROM debt_histories dh
        WHERE dh.debt_log_id = dl.id AND DATE(dh.created_at) = ?
      )
  `;
    await this.debtHistoryRepo.query(insertQuery, [targetDateStr, targetDateStr]);

    // 2. Reset toàn bộ debt_logs (không điều kiện WHERE)
    const updateQuery = `
    UPDATE debt_logs
    SET
      debt_msg = NULL,
      send_at = NULL,
      error_msg = NULL,
      first_remind = NULL,
      first_remind_at = NULL,
      second_remind = NULL,
      second_remind_at = NULL,
      sale_msg = NULL,
      debt_img = NULL,
      remind_status = 'Not Sent'
  `;
    await this.debtHistoryRepo.query(updateQuery);

    this.logger.log(
      `[CRON] Đã snapshot debt_logs cho ngày ${targetDateStr} và reset toàn bộ debt_logs.`,
    );
  }
}

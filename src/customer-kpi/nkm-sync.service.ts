import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NkmSaleMap } from './nkm-sale-map.entity';
import { CustomerRevenueDaily } from './customer-revenue-daily.entity';
import { NkmSyncLog } from './nkm-sync-log.entity';
import { SaleRevenueTarget } from './sale-revenue-target.entity';
import { NkmApiClient } from './nkm-api.client';
import { NkmMappingService } from './nkm-mapping.service';
import { vnToday, shiftDateStr } from './vn-date';
import { fiscalYearOf } from './nkm-fiscal';

/**
 * Đồng bộ dữ liệu từ API NKM về main DB (thiết kế §4).
 *
 *   API NKM ──► job đồng bộ ──► nkm_sale_map / customer_revenue_daily /
 *   sale_revenue_target ──► engine chấm điểm đọc lúc viết báo cáo
 *
 * Ba việc, tách riêng để lỗi một việc không chặn việc kia:
 *   - doanh thu theo NGÀY (gọi theo từng sale, 1 ngày/lần)
 *   - chỉ tiêu theo QUÝ (gọi cả năm tài chính, có cache vì API quý cache ~6h)
 *   - dò nhân viên mới / đổi tên trong NKM mà bảng tra chưa có
 */
@Injectable()
export class NkmSyncService {
  private readonly logger = new Logger(NkmSyncService.name);

  /** Bao nhiêu ngày liên tiếp thì job tự gọi bù khi phát hiện hụt. */
  private static readonly BACKFILL_DAYS = 30;

  constructor(
    @InjectRepository(CustomerRevenueDaily)
    private readonly revenueRepo: Repository<CustomerRevenueDaily>,
    @InjectRepository(NkmSyncLog)
    private readonly syncLogRepo: Repository<NkmSyncLog>,
    @InjectRepository(SaleRevenueTarget)
    private readonly targetRepo: Repository<SaleRevenueTarget>,
    @InjectRepository(NkmSaleMap)
    private readonly saleMapRepo: Repository<NkmSaleMap>,
    private readonly api: NkmApiClient,
    private readonly mapping: NkmMappingService,
  ) {}

  // ------------------------------------------------------- doanh thu ngày

  /**
   * Chốt doanh thu MỘT ngày cho TẤT CẢ sale trong bảng tra.
   *
   * Gọi theo `slpCode` chứ không theo khách: mỗi lần gọi trả về toàn bộ khách
   * của sale trong ngày đó → vừa có doanh số của sale, vừa biết từng khách có
   * phát sinh. Khách do nhiều sale cùng quản lý thì mỗi sale chỉ tính phần phiếu
   * do mình bán, không đếm trùng.
   *
   * `from = to = day` bắt buộc: `from`/`to` lấy CẢ HAI ĐẦU nên gọi
   * "đầu ngày D tới đầu ngày D+1" sẽ lấy tràn hai ngày.
   *
   * Sale nào gọi lỗi thì ghi log và bỏ qua, không làm hỏng cả ngày — lần chạy
   * sau (và job bù dữ liệu) sẽ lấy lại.
   *
   * Không truyền `day` thì đồng bộ hôm nay — số còn tạm (SAP nạp dở).
   */
  async syncRevenueDay(day?: string): Promise<{
    day: string;
    sales: number;
    rows: number;
    failed: number;
    provisional: boolean;
  }> {
    const target = day ?? vnToday();
    const sales = await this.mapping.listSales();
    if (sales.length === 0) {
      throw new Error(
        'Chưa có bảng tra mã nhân viên — nạp file bang_ma_doiCHieu.xlsx trước',
      );
    }
    const grpId = await this.api.syncGrpId();
    const provisional = target === vnToday();
    const rows: Array<Record<string, unknown>> = [];
    let failed = 0;

    for (const sale of sales) {
      try {
        const apiRows = await this.api.getRevenue({
          from: target,
          to: target,
          slpCode: sale.slp_code,
          grpId,
        });
        rows.push(
          ...this.aggregateRows(sale.slp_code, target, apiRows, provisional),
        );
      } catch (error: any) {
        failed += 1;
        this.logger.warn(
          `Đồng bộ doanh thu ${target} — sale ${sale.sale_label} (slpCode=${sale.slp_code}) thất bại: ${error?.message}`,
        );
      }
    }

    if (rows.length > 0) {
      await this.upsertRevenue(rows);
    }
    this.logger.log(
      `Đồng bộ doanh thu ${target}: ${sales.length - failed}/${sales.length} sale, ${rows.length} dòng khách${provisional ? ' (tạm tính)' : ''}`,
    );
    // Ghi nhật ký kể cả khi 0 dòng (ngày nghỉ): nhờ đó soi hụt phân biệt được
    // "chưa chạy" với "đã chạy, hôm đó cả công ty không bán gì" — khỏi tốn 72
    // lần gọi API mỗi đêm cho những ngày đã biết chắc không có số.
    await this.syncLogRepo
      .createQueryBuilder()
      .insert()
      .into(NkmSyncLog)
      .values({
        stat_date: target,
        sales: sales.length,
        rows: rows.length,
        failed,
        provisional,
      })
      .orUpdate({ overwrite: ['sales', 'rows', 'failed', 'provisional'] })
      .execute();
    return {
      day: target,
      sales: sales.length,
      rows: rows.length,
      failed,
      provisional,
    };
  }

  /**
   * Gộp dòng API theo (mã khách, sale, ngày) — một khách có thể về nhiều dòng
   * trong cùng ngày (nhiều phiếu/nhiều chi nhánh), cộng lại để giữ đúng nghĩa
   * của khóa UNIQUE.
   */
  private aggregateRows(
    slpCode: number,
    day: string,
    apiRows: {
      cardCode: string;
      quantity: number;
      lineTotal: number;
      lineVat: number;
      gTotal: number;
      grossProfit: number;
    }[],
    provisional: boolean,
  ): Array<Record<string, unknown>> {
    const byCustomer = new Map<
      string,
      {
        quantity: number;
        lineTotal: number;
        lineVat: number;
        gTotal: number;
        grossProfit: number;
      }
    >();
    for (const row of apiRows) {
      if (!row.cardCode) continue;
      const acc = byCustomer.get(row.cardCode) ?? {
        quantity: 0,
        lineTotal: 0,
        lineVat: 0,
        gTotal: 0,
        grossProfit: 0,
      };
      acc.quantity += row.quantity;
      acc.lineTotal += row.lineTotal;
      acc.lineVat += row.lineVat;
      acc.gTotal += row.gTotal;
      acc.grossProfit += row.grossProfit;
      byCustomer.set(row.cardCode, acc);
    }
    return [...byCustomer.entries()].map(([customerCode, acc]) => ({
      customer_code: customerCode,
      slp_code: slpCode,
      stat_date: day,
      quantity: acc.quantity,
      line_total: acc.lineTotal,
      line_vat: acc.lineVat,
      g_total: acc.gTotal,
      gross_profit: acc.grossProfit,
      card_code: customerCode,
      is_provisional: provisional ? 1 : 0,
    }));
  }

  /**
   * Upsert theo UNIQUE(customer_code, slp_code, stat_date). Mã khách không
   * phải khách thật (`KHACHVANGLAI`, `PHONGMARKETING`...) vẫn lưu — lọc khớp
   * với bảng khách là việc của lúc chấm điểm, lưu thô để truy vết.
   */
  private async upsertRevenue(rows: Array<Record<string, unknown>>) {
    const now = new Date();
    const values = rows.map((row) => [...Object.values(row), now, now]);
    await this.revenueRepo.manager.query(
      `INSERT INTO customer_revenue_daily
         (customer_code, slp_code, stat_date, quantity, line_total, line_vat,
          g_total, gross_profit, card_code, is_provisional, created_at, updated_at)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         quantity = VALUES(quantity),
         line_total = VALUES(line_total),
         line_vat = VALUES(line_vat),
         g_total = VALUES(g_total),
         gross_profit = VALUES(gross_profit),
         card_code = VALUES(card_code),
         is_provisional = VALUES(is_provisional),
         updated_at = VALUES(updated_at)`,
      [values],
    );
  }

  /**
   * Ngày còn thiếu trong khoảng (để backfill, tối đa BACKFILL_DAYS).
   *
   * Ngày coi là xong nếu **có dữ liệu** HOẶC **đã chạy thành công** (nhật ký
   * `nkm_sync_log`, `failed = 0`) — ngày nghỉ không có phiếu vẫn nằm trong nhật
   * ký nên không bị gọi lại mãi. Ngày chạy bị lỗi (`failed > 0`) vẫn bị coi là
   * hụt để lần sau thử lại.
   */
  async findMissingDays(from: string, to: string): Promise<string[]> {
    const dayKey = (value: string | Date): string =>
      value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value).slice(0, 10);

    const dataDays = await this.revenueRepo
      .createQueryBuilder('r')
      .select('DISTINCT r.stat_date', 'stat_date')
      .where('r.stat_date >= :from AND r.stat_date <= :to', { from, to })
      .getRawMany<{ stat_date: string | Date }>();
    const done = new Set(dataDays.map((row) => dayKey(row.stat_date)));

    const logs = await this.syncLogRepo
      .createQueryBuilder('l')
      .select('l.stat_date', 'stat_date')
      .addSelect('l.failed', 'failed')
      .where('l.stat_date >= :from AND l.stat_date <= :to', { from, to })
      .getRawMany<{ stat_date: string | Date; failed: string | number }>();
    for (const log of logs) {
      if (Number(log.failed) === 0) done.add(dayKey(log.stat_date));
    }

    const missing: string[] = [];
    let cursor = from;
    while (cursor <= to && missing.length < NkmSyncService.BACKFILL_DAYS) {
      if (!done.has(cursor)) missing.push(cursor);
      cursor = shiftDateStr(cursor, 1);
    }
    return missing;
  }

  /**
   * Ngày còn hụt trong 30 ngày gần nhất (mặc định) — dùng cho màn quản trị và
   * cho chính cron soi trước khi báo cáo. Ngày hôm nay không tính: trong ngày
   * vốn chưa chốt.
   */
  async missingDays(from?: string, to?: string): Promise<string[]> {
    const end = to ?? shiftDateStr(vnToday(), -1);
    const start = from ?? shiftDateStr(end, -29);
    return this.findMissingDays(start, end);
  }

  // -------------------------------------------------------- chỉ tiêu quý

  /**
   * Chốt chỉ tiêu + thực tế theo quý của cả năm tài chính.
   *
   * API quý chỉ nhận `year` và trả về đủ 4 quý trong một lần gọi, nên một lần
   * đồng bộ là xong cả năm. Theo lead API có cache ~6 tiếng nên lần gọi lại
   * gần nhau sẽ bỏ qua (trừ khi `force`) — tránh vừa tốn công vừa lấy số cũ.
   */
  async syncQuarterTargets(options: { year?: number; force?: boolean } = {}) {
    const today = vnToday();
    const year = options.year ?? fiscalYearOf(today);
    const cacheHours = await this.api.quarterCacheHours();
    if (!options.force && cacheHours > 0) {
      const last = await this.targetRepo
        .createQueryBuilder('t')
        .select('MAX(t.updated_at)', 'last')
        .where('t.fiscal_year = :year', { year })
        .getRawOne<{ last: string | Date | null }>();
      if (last?.last) {
        const ageMs = Date.now() - new Date(last.last).getTime();
        if (Number.isFinite(ageMs) && ageMs < cacheHours * 3600 * 1000) {
          return {
            year,
            skipped: true,
            reason: `Dữ liệu quý mới đồng bộ cách đây ${Math.floor(ageMs / 60000)} phút (cache ${cacheHours}h)`,
          };
        }
      }
    }

    const apiRows = await this.api.getQuarterTargets(year);
    const byEmployeeCode = new Map<string, NkmSaleMap>();
    for (const sale of await this.mapping.listSales()) {
      byEmployeeCode.set(sale.employee_code, sale);
    }

    const unknown: string[] = [];
    const rows: Array<Record<string, unknown>> = [];
    for (const row of apiRows) {
      const employeeCode = NkmApiClient.employeeCodeOf(row.saleLabel);
      const sale = byEmployeeCode.get(employeeCode);
      if (!sale) {
        unknown.push(row.saleLabel);
        continue;
      }
      for (let quarter = 1; quarter <= 4; quarter += 1) {
        rows.push({
          slp_code: sale.slp_code,
          sale_label: row.saleLabel,
          fiscal_year: year,
          quarter,
          target_value: row.targetByQuarter[quarter - 1],
          actual_value: row.actualByQuarter[quarter - 1],
          ratio: row.ratioByQuarter[quarter - 1] ?? null,
        });
      }
    }

    if (rows.length > 0) {
      await this.upsertQuarterTargets(rows);
    }
    if (unknown.length > 0) {
      this.logger.warn(
        `Chỉ tiêu quý ${year}: ${unknown.length} nhân viên chưa có trong bảng tra mã (cần nạp lại file bang_ma_doiCHieu.xlsx): ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}`,
      );
    }
    this.logger.log(
      `Chỉ tiêu quý ${year}: ${rows.length / 4} nhân viên (${rows.length} dòng quý)`,
    );
    return { year, rows: rows.length, skipped: false, unknown: unknown.length };
  }

  private async upsertQuarterTargets(rows: Array<Record<string, unknown>>) {
    const now = new Date();
    const values = rows.map((row) => [...Object.values(row), now, now]);
    await this.targetRepo.manager.query(
      `INSERT INTO sale_revenue_target
         (slp_code, sale_label, fiscal_year, quarter, target_value, actual_value,
          ratio, created_at, updated_at)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         sale_label = VALUES(sale_label),
         target_value = VALUES(target_value),
         actual_value = VALUES(actual_value),
         ratio = VALUES(ratio),
         updated_at = VALUES(updated_at)`,
      [values],
    );
  }

  /**
   * Đối chiếu nhãn/phòng ban giữa API quý và bảng tra — phát hiện nhân viên mới
   * hoặc bị đổi tên để người quản trị nạp lại file tra mã. Không tự sửa bảng
   * tra: API không trả `slpCode` nên không dựng lại được khóa nối.
   */
  async auditSaleMap(): Promise<{ unknown: string[]; relabelled: string[] }> {
    const today = vnToday();
    const apiRows = await this.api.getQuarterTargets(fiscalYearOf(today));
    const byEmployeeCode = new Map<string, NkmSaleMap>();
    for (const sale of await this.mapping.listSales()) {
      byEmployeeCode.set(sale.employee_code, sale);
    }
    const unknown: string[] = [];
    const relabelled: string[] = [];
    for (const row of apiRows) {
      const sale = byEmployeeCode.get(
        NkmApiClient.employeeCodeOf(row.saleLabel),
      );
      if (!sale) {
        unknown.push(row.saleLabel);
      } else if (sale.sale_label !== row.saleLabel) {
        relabelled.push(`${sale.sale_label} → ${row.saleLabel}`);
      }
    }
    return { unknown, relabelled };
  }
}

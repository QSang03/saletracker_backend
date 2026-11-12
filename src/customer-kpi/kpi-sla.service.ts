import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { KpiSlaViolation } from './kpi-sla-violation.entity';
import { KpiSlaResponseType } from './kpi-sla-interval.entity';
import { KpiScopeService, KpiUser } from './kpi-scope.service';
import { KpiSaleDirectoryService } from './kpi-sale-directory.service';
import { Customer } from './customer.entity';
import { vnToday } from './vn-date';

export interface KpiSlaQuery {
  period?: string;
  saleId?: number;
  customerCode?: string;
  /** Khớp một phần tên/mã sale hoặc tên/mã khách. */
  search?: string;
  status?: 'all' | 'open' | 'responded' | 'none' | 'waived';
  page?: number;
  limit?: number;
}

export interface KpiSlaSummaryQuery {
  period?: string;
  saleId?: number;
}

/**
 * Đọc vi phạm SLA 2h (Python ghi) cho KPI customer.
 *
 * Quy tắc chấm: trong tháng, sale có ≥ 1 vi phạm CHƯA miễn → trượt tiêu chí
 * `sla_phan_hoi_2h`. `is_waived=1` (khiếu nại được duyệt) không tính.
 */
@Injectable()
export class KpiSlaService {
  constructor(
    @InjectRepository(KpiSlaViolation)
    private readonly violationRepo: Repository<KpiSlaViolation>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly scope: KpiScopeService,
    private readonly saleDirectory: KpiSaleDirectoryService,
  ) {}

  private normalizePeriod(period?: string): string {
    const value = period ?? vnToday().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      throw new BadRequestException('period phải có dạng YYYY-MM');
    }
    return value;
  }

  async listViolations(query: KpiSlaQuery, user: KpiUser): Promise<any> {
    const period = this.normalizePeriod(query.period);
    const userIds = await this.scope.scopeUserIds(user);
    if (query.saleId !== undefined) {
      this.scope.assertSaleInScope(query.saleId, userIds);
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));

    if (userIds !== undefined && userIds.length === 0) {
      return { period, total: 0, page, limit, items: [] };
    }

    const qb = this.violationRepo
      .createQueryBuilder('v')
      .where('v.period = :period', { period });
    if (query.saleId !== undefined) {
      qb.andWhere('v.sale_id = :saleId', { saleId: query.saleId });
    } else if (userIds !== undefined) {
      qb.andWhere('v.sale_id IN (:...userIds)', { userIds });
    }
    if (query.customerCode?.trim()) {
      qb.andWhere('v.customer_code = :customerCode', {
        customerCode: query.customerCode.trim(),
      });
    }
    switch (query.status) {
      case 'open':
        qb.andWhere('v.responded_time IS NULL');
        break;
      case 'responded':
        qb.andWhere('v.responded_time IS NOT NULL');
        break;
      case 'none':
        qb.andWhere('v.response_type = :none', {
          none: KpiSlaResponseType.NONE,
        });
        break;
      case 'waived':
        qb.andWhere('v.is_waived = :waived', { waived: true });
        break;
      default:
        break;
    }

    // Ô tìm kiếm chung: tên/mã sale HOẶC tên/mã khách. Dùng subquery để giữ
    // các bộ lọc khác dạng AND và không phải nạp sẵn danh sách ID.
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        `(
          v.sale_id IN (
            SELECT u.id FROM users u
            WHERE u.deleted_at IS NULL
              AND (u.full_name LIKE :search OR u.employee_code LIKE :search)
          )
          OR v.customer_code IN (
            SELECT c.customer_code FROM customers c
            WHERE c.status <> 'deleted'
              AND (c.customer_code LIKE :search OR c.customer_name LIKE :search)
          )
          OR v.customer_code IN (
            SELECT c2.customer_code
            FROM customer_zalo z
            JOIN customer_assignments a ON a.id = z.assignment_id
            JOIN customers c2 ON c2.id = a.customer_id
            WHERE z.is_active = 1
              AND z.matched_name LIKE :search
          )
        )`,
        { search: `%${this.escapeLike(search)}%` },
      );
    }

    const [rows, total] = await qb
      .orderBy('v.inbound_time', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const infos = await this.saleDirectory.loadSaleInfos([
      ...new Set(rows.map((row) => row.sale_id)),
    ]);
    const customerNames = await this.loadCustomerNames([
      ...new Set(rows.map((row) => row.customer_code)),
    ]);
    return {
      period,
      total,
      page,
      limit,
      items: rows.map((row) => ({
        ...row,
        saleName: infos.get(row.sale_id)?.fullName ?? null,
        customerName: customerNames.get(row.customer_code) ?? null,
      })),
    };
  }

  /** Escape ký tự đại diện để `%`/`_` người dùng gõ không thành wildcard. */
  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
  }

  private async loadCustomerNames(
    customerCodes: string[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (customerCodes.length === 0) return result;

    // customer_name của bảng customers chỉ có một phần; đa số tên thật nằm ở
    // customer_zalo.matched_name (tên hiển thị Zalo do Python đồng bộ).
    const placeholders = customerCodes.map(() => '?').join(',');
    const rows: Array<{
      customer_code: string;
      customer_name: string | null;
      matched_name: string | null;
    }> = await this.customerRepo.manager.query(
      `SELECT c.customer_code, c.customer_name, z.matched_name
       FROM customers c
       LEFT JOIN customer_assignments a ON a.customer_id = c.id
       LEFT JOIN customer_zalo z ON z.assignment_id = a.id AND z.is_active = 1
       WHERE c.customer_code IN (${placeholders})
       ORDER BY z.id ASC`,
      customerCodes,
    );
    for (const row of rows) {
      if (row.customer_name) {
        result.set(row.customer_code, row.customer_name);
      } else if (!result.has(row.customer_code) && row.matched_name) {
        result.set(row.customer_code, row.matched_name);
      }
    }
    return result;
  }

  async summary(query: KpiSlaSummaryQuery, user: KpiUser): Promise<any> {
    const period = this.normalizePeriod(query.period);
    const userIds = await this.scope.scopeUserIds(user);
    if (query.saleId !== undefined) {
      this.scope.assertSaleInScope(query.saleId, userIds);
    }

    const where: FindOptionsWhere<KpiSlaViolation> = { period };
    if (query.saleId !== undefined) {
      where.sale_id = query.saleId;
    } else if (userIds !== undefined) {
      if (userIds.length === 0) {
        return {
          period,
          totalViolations: 0,
          totalWaived: 0,
          totalEffective: 0,
          sales: [],
        };
      }
      where.sale_id = In(userIds);
    }

    const rows = await this.violationRepo.find({
      where,
      order: { sale_id: 'ASC', inbound_time: 'DESC' },
    });
    const bySale = new Map<
      number,
      {
        total: number;
        waived: number;
        effective: number;
        lastInboundTime: Date | null;
      }
    >();
    for (const row of rows) {
      const bucket = bySale.get(row.sale_id) ?? {
        total: 0,
        waived: 0,
        effective: 0,
        lastInboundTime: null,
      };
      bucket.total += 1;
      if (row.is_waived) {
        bucket.waived += 1;
      } else {
        bucket.effective += 1;
      }
      if (
        !bucket.lastInboundTime ||
        row.inbound_time > bucket.lastInboundTime
      ) {
        bucket.lastInboundTime = row.inbound_time;
      }
      bySale.set(row.sale_id, bucket);
    }

    const infos = await this.saleDirectory.loadSaleInfos([...bySale.keys()]);
    const sales = [...bySale.entries()]
      .sort(([a], [b]) => a - b)
      .map(([saleId, bucket]) => ({
        saleId,
        saleName: infos.get(saleId)?.fullName ?? null,
        total: bucket.total,
        waived: bucket.waived,
        effective: bucket.effective,
        passed: bucket.effective === 0,
        lastInboundTime: bucket.lastInboundTime,
      }));

    const totalViolations = sales.reduce((sum, row) => sum + row.total, 0);
    const totalWaived = sales.reduce((sum, row) => sum + row.waived, 0);
    return {
      period,
      totalViolations,
      totalWaived,
      totalEffective: totalViolations - totalWaived,
      sales,
    };
  }

  /** Dùng cho engine KPI sau này: sale có vi phạm chưa miễn trong tháng không. */
  async getSaleStatus(
    saleId: number,
    period?: string,
  ): Promise<{
    saleId: number;
    period: string;
    violationCount: number;
    waivedCount: number;
    passed: boolean;
  }> {
    const normalized = this.normalizePeriod(period);
    const [violationCount, waivedCount] = await Promise.all([
      this.violationRepo.count({
        where: { sale_id: saleId, period: normalized, is_waived: false },
      }),
      this.violationRepo.count({
        where: { sale_id: saleId, period: normalized, is_waived: true },
      }),
    ]);
    return {
      saleId,
      period: normalized,
      violationCount,
      waivedCount,
      passed: violationCount === 0,
    };
  }

  /**
   * Đếm vi phạm CHƯA miễn theo sale trong khoảng ngày — dùng cho engine KPI
   * (báo cáo tháng/quý). Sale không có vi phạm không nằm trong Map (đọc = 0).
   */
  async countEffectiveBySale(
    saleIds: number[],
    from: string,
    to: string,
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    if (saleIds.length === 0) return result;
    const rows = await this.violationRepo
      .createQueryBuilder('v')
      .select('v.sale_id', 'saleId')
      .addSelect('COUNT(*)', 'count')
      .where('v.sale_id IN (:...saleIds)', { saleIds })
      .andWhere('v.inbound_time >= :from', { from: `${from} 00:00:00` })
      .andWhere('v.inbound_time <= :to', { to: `${to} 23:59:59` })
      .andWhere('v.is_waived = :waived', { waived: false })
      .groupBy('v.sale_id')
      .getRawMany<{ saleId: number | string; count: string }>();
    for (const row of rows) {
      result.set(Number(row.saleId), Number(row.count) || 0);
    }
    return result;
  }
}

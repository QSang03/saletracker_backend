import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Not, Repository } from 'typeorm';
import { KpiSlaViolation } from './kpi-sla-violation.entity';
import { KpiSlaResponseType } from './kpi-sla-interval.entity';
import { KpiScopeService, KpiUser } from './kpi-scope.service';
import { KpiSaleDirectoryService } from './kpi-sale-directory.service';
import { vnToday } from './vn-date';

export interface KpiSlaQuery {
  period?: string;
  saleId?: number;
  customerCode?: string;
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

    const where: FindOptionsWhere<KpiSlaViolation> = { period };
    if (query.saleId !== undefined) {
      where.sale_id = query.saleId;
    } else if (userIds !== undefined) {
      if (userIds.length === 0) {
        return { period, total: 0, page: 1, limit: 50, items: [] };
      }
      where.sale_id = In(userIds);
    }
    if (query.customerCode?.trim()) {
      where.customer_code = query.customerCode.trim();
    }
    switch (query.status) {
      case 'open':
        where.responded_time = IsNull();
        break;
      case 'responded':
        where.responded_time = Not(IsNull());
        break;
      case 'none':
        where.response_type = KpiSlaResponseType.NONE;
        break;
      case 'waived':
        where.is_waived = true;
        break;
      default:
        break;
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const [rows, total] = await this.violationRepo.findAndCount({
      where,
      order: { inbound_time: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const infos = await this.saleDirectory.loadSaleInfos([
      ...new Set(rows.map((row) => row.sale_id)),
    ]);
    return {
      period,
      total,
      page,
      limit,
      items: rows.map((row) => ({
        ...row,
        saleName: infos.get(row.sale_id)?.fullName ?? null,
      })),
    };
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

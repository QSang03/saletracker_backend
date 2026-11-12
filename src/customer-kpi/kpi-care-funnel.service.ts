import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CustomerAssignment } from './customer-assignment.entity';
import { CustomerActivityDaily } from './customer-activity-daily.entity';
import { CustomerAppointment } from './customer-appointment.entity';
import { CustomerRevenueDaily } from './customer-revenue-daily.entity';
import { CustomerZalo } from './customer-zalo.entity';
import {
  OrderDetail,
  OrderDetailStatus,
} from '../order-details/order-detail.entity';
import { Order } from '../orders/order.entity';
import { KpiScopeService, KpiUser } from './kpi-scope.service';
import { KpiSaleDirectoryService } from './kpi-sale-directory.service';
import { FiscalQuarter, fiscalQuarterRange } from './nkm-fiscal';
import { shiftDateStr, vnToday } from './vn-date';

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export interface CareFunnelQuery {
  saleId?: number;
  from?: string;
  to?: string;
  fiscal_year?: number;
  quarter?: number;
  user: KpiUser;
}

interface FunnelWindow {
  from: string;
  to: string;
  quarter: FiscalQuarter | null;
}

interface CustomerBucket {
  saleId: number;
  customerCode: string;
  tier: string | null;
  assignmentIds: number[];
}

interface FunnelCounts {
  purchased: number;
  quoted: number;
  communicated: number;
  unreached: number;
}

const emptyCounts = (): FunnelCounts => ({
  purchased: 0,
  quoted: 0,
  communicated: 0,
  unreached: 0,
});

/**
 * Phễu 4 nhóm khách hàng chăm sóc (Sprint 3):
 *   1. purchased    — có doanh số trong kỳ
 *   2. quoted       — không doanh số, có order_detail CHƯA CHỐT trong kỳ
 *   3. communicated — không doanh số/báo giá, có Zalo hoặc lịch hẹn trong kỳ
 *   4. unreached    — không có nguồn nào
 *
 * "Báo giá" = order_detail status `quoted` hoặc `cared` (chưa completed/rejected/
 * demand). Nguồn: `order_details` + `orders.sale_by` + `meta_customer_id` nối
 * sang `customer_zalo` — KHÔNG dùng module utility `sale_quotes`.
 *
 * Ưu tiên từ trên xuống, mỗi khách chỉ nằm 1 nhóm. Đơn vị đếm là
 * (sale × customer_code) — khớp với cách customer_assignments đang lưu.
 *
 * Lưu ý: `customer_activity_daily.outbound_count` đang gồm bot; phễu chỉ cần
 * "có tương tác" nên chấp nhận, nhưng không dùng để chấm KPI phản hồi.
 */
@Injectable()
export class KpiCareFunnelService {
  constructor(
    @InjectRepository(CustomerAssignment)
    private readonly assignmentRepo: Repository<CustomerAssignment>,
    @InjectRepository(CustomerRevenueDaily)
    private readonly revenueRepo: Repository<CustomerRevenueDaily>,
    @InjectRepository(CustomerActivityDaily)
    private readonly activityRepo: Repository<CustomerActivityDaily>,
    @InjectRepository(CustomerAppointment)
    private readonly appointmentRepo: Repository<CustomerAppointment>,
    @InjectRepository(CustomerZalo)
    private readonly customerZaloRepo: Repository<CustomerZalo>,
    @InjectRepository(OrderDetail)
    private readonly orderDetailRepo: Repository<OrderDetail>,
    private readonly scope: KpiScopeService,
    private readonly saleDirectory: KpiSaleDirectoryService,
  ) {}

  private resolveWindow(query: CareFunnelQuery): FunnelWindow {
    const hasYear =
      query.fiscal_year !== undefined && query.fiscal_year !== null;
    const hasQuarter = query.quarter !== undefined && query.quarter !== null;
    if (hasYear !== hasQuarter) {
      throw new BadRequestException('fiscal_year và quarter phải đi cùng nhau');
    }
    if (hasYear) {
      const range = fiscalQuarterRange(
        Number(query.fiscal_year),
        Number(query.quarter),
      );
      if (!range) {
        throw new BadRequestException('fiscal_year/quarter không hợp lệ');
      }
      return { from: range.from, to: range.to, quarter: range };
    }

    const isDate = (value: unknown): value is string =>
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    const today = vnToday();
    const to = isDate(query.to) ? query.to : today;
    const from = isDate(query.from) ? query.from : `${to.slice(0, 7)}-01`;
    if (from > to) {
      throw new BadRequestException('from phải nhỏ hơn hoặc bằng to');
    }
    return { from, to, quarter: null };
  }

  async getStats(query: CareFunnelQuery): Promise<any> {
    const window = this.resolveWindow(query);
    const userIds = await this.scope.scopeUserIds(query.user);
    if (query.saleId !== undefined) {
      this.scope.assertSaleInScope(query.saleId, userIds);
    }

    const assignmentQb = this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoin('a.customer', 'c')
      .innerJoin('a.sale', 'sale')
      .select('a.id', 'assignmentId')
      .addSelect('a.sale_id', 'saleId')
      .addSelect('a.customer_tier', 'tier')
      .addSelect('c.customer_code', 'customerCode')
      .where('c.status <> :deleted', { deleted: 'deleted' })
      .andWhere('sale.deletedAt IS NULL');
    if (query.saleId !== undefined) {
      assignmentQb.andWhere('a.sale_id = :saleId', { saleId: query.saleId });
    } else if (userIds !== undefined) {
      if (userIds.length === 0) return this.emptyResponse(window, []);
      assignmentQb.andWhere('a.sale_id IN (:...userIds)', { userIds });
    }

    const assignmentRows = await assignmentQb.getRawMany<{
      assignmentId: number | string;
      saleId: number | string;
      tier: string | null;
      customerCode: string;
    }>();

    const bucketMap = new Map<string, CustomerBucket>();
    for (const row of assignmentRows) {
      const saleId = Number(row.saleId);
      const customerCode = String(row.customerCode ?? '').trim();
      if (!saleId || !customerCode) continue;
      const key = `${saleId}|${customerCode}`;
      const bucket = bucketMap.get(key) ?? {
        saleId,
        customerCode,
        tier: row.tier ?? null,
        assignmentIds: [],
      };
      // Trùng customer_code (nhiều sap_code) — giữ tier mạnh hơn để hiển thị.
      if (String(row.tier ?? '').toUpperCase() === 'KEY') {
        bucket.tier = 'KEY';
      }
      bucket.assignmentIds.push(Number(row.assignmentId));
      bucketMap.set(key, bucket);
    }

    const buckets = [...bucketMap.values()];
    if (buckets.length === 0) return this.emptyResponse(window, []);

    const saleIds = [...new Set(buckets.map((bucket) => bucket.saleId))].sort(
      (a, b) => a - b,
    );
    const saleInfos = await this.saleDirectory.loadSaleInfos(saleIds);
    const mappings = await this.saleDirectory.loadMappings(saleIds, saleInfos);

    const purchased = await this.loadPurchased(mappings, window);
    const quoted = await this.loadQuoted(bucketMap, saleIds, window);
    const activity = await this.loadActivity(
      [...new Set(buckets.flatMap((bucket) => bucket.assignmentIds))],
      window,
    );
    const appointments = await this.loadAppointments(saleIds, window);

    const bySale = new Map<number, FunnelCounts>();
    for (const bucket of buckets) {
      const counts = bySale.get(bucket.saleId) ?? emptyCounts();
      if (purchased.has(`${bucket.saleId}|${bucket.customerCode}`)) {
        counts.purchased += 1;
      } else if (quoted.has(`${bucket.saleId}|${bucket.customerCode}`)) {
        counts.quoted += 1;
      } else {
        const activityCount = bucket.assignmentIds.reduce(
          (total, assignmentId) => total + (activity.get(assignmentId) ?? 0),
          0,
        );
        const hasAppointment = appointments.has(
          `${bucket.saleId}|${bucket.customerCode}`,
        );
        if (activityCount > 0 || hasAppointment) {
          counts.communicated += 1;
        } else {
          counts.unreached += 1;
        }
      }
      bySale.set(bucket.saleId, counts);
    }

    const rows = saleIds.map((saleId) => {
      const counts = bySale.get(saleId) ?? emptyCounts();
      const total =
        counts.purchased +
        counts.quoted +
        counts.communicated +
        counts.unreached;
      const pct = (value: number) =>
        total > 0 ? round2((value / total) * 100) : 0;
      return {
        saleId,
        saleName: saleInfos.get(saleId)?.fullName ?? null,
        totalCustomers: total,
        purchased: { count: counts.purchased, percent: pct(counts.purchased) },
        quoted: { count: counts.quoted, percent: pct(counts.quoted) },
        communicated: {
          count: counts.communicated,
          percent: pct(counts.communicated),
        },
        unreached: {
          count: counts.unreached,
          percent: pct(counts.unreached),
        },
      };
    });

    const totalCustomers = rows.reduce(
      (total, row) => total + row.totalCustomers,
      0,
    );
    const sum = (key: 'purchased' | 'quoted' | 'communicated' | 'unreached') =>
      rows.reduce((total, row) => total + row[key].count, 0);
    const pct = (value: number) =>
      totalCustomers > 0 ? round2((value / totalCustomers) * 100) : 0;

    return {
      window: {
        from: window.from,
        to: window.to,
        quarter: window.quarter,
      },
      totalCustomers,
      purchased: { count: sum('purchased'), percent: pct(sum('purchased')) },
      quoted: { count: sum('quoted'), percent: pct(sum('quoted')) },
      communicated: {
        count: sum('communicated'),
        percent: pct(sum('communicated')),
      },
      unreached: { count: sum('unreached'), percent: pct(sum('unreached')) },
      bySale: rows,
    };
  }

  private emptyResponse(window: FunnelWindow, bySale: any[]): any {
    return {
      window: { from: window.from, to: window.to, quarter: window.quarter },
      totalCustomers: 0,
      purchased: { count: 0, percent: 0 },
      quoted: { count: 0, percent: 0 },
      communicated: { count: 0, percent: 0 },
      unreached: { count: 0, percent: 0 },
      bySale,
    };
  }

  /** Set `saleId|customerCode` có doanh số (quantity > 0) trong kỳ. */
  private async loadPurchased(
    mappings: Array<{ saleId: number; slpCodes: number[] }>,
    window: FunnelWindow,
  ): Promise<Set<string>> {
    const result = new Set<string>();
    const slpCodes = [...new Set(mappings.flatMap((m) => m.slpCodes))];
    if (slpCodes.length === 0) return result;

    const revenueBySlp = new Map<number, Set<string>>();
    for (let i = 0; i < slpCodes.length; i += 200) {
      const chunk = slpCodes.slice(i, i + 200);
      const rows = await this.revenueRepo
        .createQueryBuilder('r')
        .select('r.slp_code', 'slpCode')
        .addSelect('r.customer_code', 'customerCode')
        .addSelect('SUM(r.quantity)', 'quantity')
        .where('r.slp_code IN (:...slp)', { slp: chunk })
        .andWhere('r.stat_date >= :from', { from: window.from })
        .andWhere('r.stat_date <= :to', { to: window.to })
        .groupBy('r.slp_code')
        .addGroupBy('r.customer_code')
        .getRawMany<{
          slpCode: number | string;
          customerCode: string;
          quantity: string;
        }>();
      for (const row of rows) {
        if ((Number(row.quantity) || 0) <= 0) continue;
        const code = String(row.customerCode ?? '').trim();
        if (!code) continue;
        const set = revenueBySlp.get(Number(row.slpCode)) ?? new Set<string>();
        set.add(code);
        revenueBySlp.set(Number(row.slpCode), set);
      }
    }

    for (const mapping of mappings) {
      for (const slpCode of mapping.slpCodes) {
        for (const code of revenueBySlp.get(slpCode) ?? []) {
          result.add(`${mapping.saleId}|${code}`);
        }
      }
    }
    return result;
  }

  /**
   * Set `saleId|customerCode` có order_detail CHƯA CHỐT trong kỳ.
   *
   * "Chưa chốt" = status `quoted` hoặc `cared` (chưa completed/rejected/demand).
   * Nối đơn về khách đúng đường của engine gợi ý đơn hàng:
   *   orders.sale_by → sale
   *   order_details.meta_customer_id = customer_zalo.zalo_contact_id
   *   customer_zalo.assignment_id → assignment
   */
  private async loadQuoted(
    bucketMap: Map<string, CustomerBucket>,
    saleIds: number[],
    window: FunnelWindow,
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (saleIds.length === 0 || bucketMap.size === 0) return result;

    const bucketKeyByAssignment = new Map<number, string>();
    const saleIdByAssignment = new Map<number, number>();
    for (const [key, bucket] of bucketMap) {
      for (const assignmentId of bucket.assignmentIds) {
        bucketKeyByAssignment.set(assignmentId, key);
        saleIdByAssignment.set(assignmentId, bucket.saleId);
      }
    }

    // (saleId|contactId) -> assignmentId; trùng contact thì lấy assignment nhỏ
    // nhất để không đếm hai lần cho cùng một khách.
    const assignmentByContact = new Map<string, number>();
    const assignmentIds = [...bucketKeyByAssignment.keys()];
    for (let i = 0; i < assignmentIds.length; i += 1000) {
      const chunk = assignmentIds.slice(i, i + 1000);
      const links = await this.customerZaloRepo.find({
        where: { assignment_id: In(chunk), is_active: true },
        select: ['assignment_id', 'zalo_contact_id'],
      });
      for (const link of links) {
        const saleId = saleIdByAssignment.get(link.assignment_id);
        const contact = String(link.zalo_contact_id ?? '').trim();
        if (saleId === undefined || !contact) continue;
        const key = `${saleId}|${contact}`;
        const current = assignmentByContact.get(key);
        if (current === undefined || link.assignment_id < current) {
          assignmentByContact.set(key, link.assignment_id);
        }
      }
    }
    if (assignmentByContact.size === 0) return result;

    const from = `${window.from} 00:00:00`;
    const toExclusive = `${shiftDateStr(window.to, 1)} 00:00:00`;

    for (let i = 0; i < saleIds.length; i += 25) {
      const chunk = saleIds.slice(i, i + 25);
      const rows = await this.orderDetailRepo
        .createQueryBuilder('od')
        .innerJoin(Order, 'o', 'o.id = od.order_id')
        .select('o.sale_by', 'saleId')
        .addSelect('od.meta_customer_id', 'contactId')
        .where('o.sale_by IN (:...saleIds)', { saleIds: chunk })
        .andWhere('od.meta_customer_id IS NOT NULL')
        .andWhere('od.deleted_at IS NULL')
        .andWhere('od.hidden_at IS NULL')
        .andWhere('od.meta_is_group = 0')
        .andWhere('od.status IN (:...statuses)', {
          statuses: [OrderDetailStatus.QUOTED, OrderDetailStatus.CARED],
        })
        .andWhere('od.created_at >= :from', { from })
        .andWhere('od.created_at < :toExclusive', { toExclusive })
        .getRawMany<{ saleId: number | string; contactId: string }>();

      for (const row of rows) {
        const saleId = Number(row.saleId);
        const contact = String(row.contactId ?? '').trim();
        if (!contact) continue;
        const assignmentId = assignmentByContact.get(`${saleId}|${contact}`);
        if (assignmentId === undefined) continue;
        const bucketKey = bucketKeyByAssignment.get(assignmentId);
        if (bucketKey) result.add(bucketKey);
      }
    }
    return result;
  }

  /** Tổng số tin Zalo (in + out) theo assignment trong kỳ. */
  private async loadActivity(
    assignmentIds: number[],
    window: FunnelWindow,
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    for (let i = 0; i < assignmentIds.length; i += 500) {
      const chunk = assignmentIds.slice(i, i + 500);
      const rows = await this.activityRepo
        .createQueryBuilder('a')
        .select('a.assignment_id', 'assignmentId')
        .addSelect('SUM(a.inbound_count)', 'inbound')
        .addSelect('SUM(a.outbound_count)', 'outbound')
        .where('a.assignment_id IN (:...chunk)', { chunk })
        .andWhere('a.stat_date >= :from', { from: window.from })
        .andWhere('a.stat_date <= :to', { to: window.to })
        .groupBy('a.assignment_id')
        .getRawMany<{
          assignmentId: number | string;
          inbound: string;
          outbound: string;
        }>();
      for (const row of rows) {
        result.set(
          Number(row.assignmentId),
          (Number(row.inbound) || 0) + (Number(row.outbound) || 0),
        );
      }
    }
    return result;
  }

  /** Set `userId|customerCode` có lịch hẹn hợp lệ trong kỳ. */
  private async loadAppointments(
    saleIds: number[],
    window: FunnelWindow,
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (saleIds.length === 0) return result;
    const rows = await this.appointmentRepo
      .createQueryBuilder('ap')
      .select('ap.user_id', 'userId')
      .addSelect('ap.customer_code', 'customerCode')
      .where('ap.user_id IN (:...saleIds)', { saleIds })
      .andWhere('ap.mapping_status = :matched', { matched: 'matched' })
      .andWhere('ap.status IN (:...statuses)', {
        statuses: ['approved', 'checked_in', 'completed'],
      })
      .andWhere(
        'COALESCE(ap.checkin_at, ap.scheduled_at) >= :from AND COALESCE(ap.checkin_at, ap.scheduled_at) <= :to',
        { from: `${window.from} 00:00:00`, to: `${window.to} 23:59:59` },
      )
      .getRawMany<{ userId: number | string; customerCode: string }>();
    for (const row of rows) {
      const code = String(row.customerCode ?? '').trim();
      if (!code) continue;
      result.add(`${Number(row.userId)}|${code}`);
    }
    return result;
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CustomerActivityDaily } from './customer-activity-daily.entity';
import { CustomerInteractionSummary } from './customer-interaction-summary.entity';
import { CustomerAppointment } from './customer-appointment.entity';
import { CustomerZalo } from './customer-zalo.entity';
import {
  OrderDetail,
  OrderDetailStatus,
} from '../order-details/order-detail.entity';
import { Order } from '../orders/order.entity';
import { shiftDateStr } from './vn-date';

export type CareStage = 'purchased' | 'quoted' | 'communicated' | 'unreached';

export interface CustomerInteractionInput {
  assignmentId: number;
  customerCode: string;
  /** Số phiếu NKM trong kỳ — >0 là đã mua. */
  nkmQuantity: number;
  /** `has_revenue` từ engine KPI — phòng trường hợp quantity 0 nhưng có tiền. */
  hasRevenue?: boolean;
}

export interface CustomerInteractionInfo {
  careStage: CareStage;
  zalo: {
    inCount: number;
    outCount: number;
    lastMessageAt: string | null;
    /**
     * `timestamp` = giờ gốc từ customer_interaction_summary; `day` = chỉ biết
     * ngày từ customer_activity_daily; `none` = chưa có dữ liệu.
     */
    lastMessagePrecision: 'timestamp' | 'day' | 'none';
    isActive: boolean;
    lastVerifiedAt: string | null;
  };
  appointment: {
    lastVisitAt: string | null;
    status: string | null;
    appointmentCode: string | null;
  };
  quote: {
    quoteCount: number;
    lastQuoteAt: string | null;
    lastQuoteAmount: number;
  };
}

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

/**
 * Gắn dữ liệu tương tác vào từng khách của `by-sale`.
 *
 * Nguồn:
 *   - Zalo đếm/ngày: customer_activity_daily (rollup Python).
 *   - Trạng thái khớp Zalo: customer_zalo (is_active/last_verified_at).
 *   - Lịch hẹn: customer_appointments.
 *   - "Báo giá" = order_details status quoted/cared (chưa chốt) + orders.sale_by
 *     + meta_customer_id khớp customer_zalo.
 *
 * `lastMessageAt` ưu tiên `customer_interaction_summary` (Python ghi timestamp
 * gốc); nếu assignment chưa có dòng summary mới fallback về grain NGÀY của
 * `customer_activity_daily` với `lastMessagePrecision='day'`.
 */
@Injectable()
export class KpiCustomerInteractionService {
  constructor(
    @InjectRepository(CustomerActivityDaily)
    private readonly activityRepo: Repository<CustomerActivityDaily>,
    @InjectRepository(CustomerInteractionSummary)
    private readonly summaryRepo: Repository<CustomerInteractionSummary>,
    @InjectRepository(CustomerZalo)
    private readonly customerZaloRepo: Repository<CustomerZalo>,
    @InjectRepository(CustomerAppointment)
    private readonly appointmentRepo: Repository<CustomerAppointment>,
    @InjectRepository(OrderDetail)
    private readonly orderDetailRepo: Repository<OrderDetail>,
  ) {}

  async enrich(
    saleId: number,
    from: string,
    to: string,
    customers: CustomerInteractionInput[],
  ): Promise<Map<number, CustomerInteractionInfo>> {
    const result = new Map<number, CustomerInteractionInfo>();
    if (customers.length === 0) return result;

    const assignmentIds = [...new Set(customers.map((c) => c.assignmentId))];
    const customerCodes = [
      ...new Set(customers.map((c) => c.customerCode).filter(Boolean)),
    ];

    const activity = await this.loadActivity(assignmentIds, from, to);
    const summaries = await this.loadSummaries(assignmentIds);
    const zaloState = await this.loadZaloState(assignmentIds);
    const appointments = await this.loadAppointments(
      saleId,
      customerCodes,
      from,
      to,
    );
    const quotes = await this.loadQuotes(saleId, assignmentIds, from, to);

    for (const customer of customers) {
      const act = activity.get(customer.assignmentId);
      const summary = summaries.get(customer.assignmentId);
      const zalo = zaloState.get(customer.assignmentId);
      const appointment = appointments.get(customer.customerCode);
      const quote = quotes.get(customer.assignmentId);
      const quoteCount = quote?.count ?? 0;
      const inCount = act?.inbound ?? 0;
      const outCount = act?.outbound ?? 0;
      const hasAppointment = !!appointment?.status;

      let careStage: CareStage;
      if (customer.nkmQuantity > 0 || customer.hasRevenue) {
        careStage = 'purchased';
      } else if (quoteCount > 0) {
        careStage = 'quoted';
      } else if (inCount + outCount > 0 || hasAppointment) {
        careStage = 'communicated';
      } else {
        careStage = 'unreached';
      }

      result.set(customer.assignmentId, {
        careStage,
        zalo: {
          inCount,
          outCount,
          lastMessageAt: summary?.last_message_at
            ? toIso(summary.last_message_at)
            : act?.lastDate
              ? `${act.lastDate}T00:00:00+07:00`
              : null,
          lastMessagePrecision: summary?.last_message_at
            ? 'timestamp'
            : act?.lastDate
              ? 'day'
              : 'none',
          isActive: zalo?.isActive ?? false,
          lastVerifiedAt: toIso(zalo?.lastVerifiedAt),
        },
        appointment: {
          lastVisitAt: toIso(appointment?.lastVisitAt),
          status: appointment?.status ?? null,
          appointmentCode: appointment?.appointmentCode ?? null,
        },
        quote: {
          quoteCount,
          lastQuoteAt: toIso(quote?.lastQuoteAt),
          lastQuoteAmount: Math.round((quote?.amount ?? 0) * 100) / 100,
        },
      });
    }

    return result;
  }

  private async loadActivity(
    assignmentIds: number[],
    from: string,
    to: string,
  ): Promise<
    Map<number, { inbound: number; outbound: number; lastDate: string | null }>
  > {
    const result = new Map<
      number,
      { inbound: number; outbound: number; lastDate: string | null }
    >();
    for (let i = 0; i < assignmentIds.length; i += 500) {
      const chunk = assignmentIds.slice(i, i + 500);
      const rows = await this.activityRepo
        .createQueryBuilder('a')
        .select('a.assignment_id', 'assignmentId')
        .addSelect('SUM(a.inbound_count)', 'inbound')
        .addSelect('SUM(a.outbound_count)', 'outbound')
        .addSelect('MAX(a.stat_date)', 'lastDate')
        .where('a.assignment_id IN (:...chunk)', { chunk })
        .andWhere('a.stat_date >= :from', { from })
        .andWhere('a.stat_date <= :to', { to })
        .groupBy('a.assignment_id')
        .getRawMany<{
          assignmentId: number | string;
          inbound: string;
          outbound: string;
          lastDate: string | null;
        }>();
      for (const row of rows) {
        result.set(Number(row.assignmentId), {
          inbound: Number(row.inbound) || 0,
          outbound: Number(row.outbound) || 0,
          lastDate: row.lastDate ?? null,
        });
      }
    }
    return result;
  }

  private async loadSummaries(
    assignmentIds: number[],
  ): Promise<Map<number, CustomerInteractionSummary>> {
    const result = new Map<number, CustomerInteractionSummary>();
    for (let i = 0; i < assignmentIds.length; i += 1000) {
      const chunk = assignmentIds.slice(i, i + 1000);
      const rows = await this.summaryRepo.find({
        where: { assignment_id: In(chunk) },
      });
      for (const row of rows) result.set(row.assignment_id, row);
    }
    return result;
  }

  private async loadZaloState(
    assignmentIds: number[],
  ): Promise<Map<number, { isActive: boolean; lastVerifiedAt: Date | null }>> {
    const result = new Map<
      number,
      { isActive: boolean; lastVerifiedAt: Date | null }
    >();
    for (let i = 0; i < assignmentIds.length; i += 1000) {
      const chunk = assignmentIds.slice(i, i + 1000);
      const links = await this.customerZaloRepo.find({
        where: { assignment_id: In(chunk), is_active: true },
        select: ['assignment_id', 'last_verified_at'],
      });
      for (const link of links) {
        const current = result.get(link.assignment_id) ?? {
          isActive: true,
          lastVerifiedAt: null,
        };
        current.isActive = true;
        if (
          link.last_verified_at &&
          (!current.lastVerifiedAt ||
            link.last_verified_at > current.lastVerifiedAt)
        ) {
          current.lastVerifiedAt = link.last_verified_at;
        }
        result.set(link.assignment_id, current);
      }
    }
    return result;
  }

  private async loadAppointments(
    saleId: number,
    customerCodes: string[],
    from: string,
    to: string,
  ): Promise<
    Map<
      string,
      {
        lastVisitAt: string | null;
        status: string | null;
        appointmentCode: string | null;
      }
    >
  > {
    const result = new Map<
      string,
      {
        lastVisitAt: string | null;
        status: string | null;
        appointmentCode: string | null;
      }
    >();
    if (customerCodes.length === 0) return result;
    for (let i = 0; i < customerCodes.length; i += 500) {
      const chunk = customerCodes.slice(i, i + 500);
      const rows = await this.appointmentRepo
        .createQueryBuilder('ap')
        .select('ap.customer_code', 'customerCode')
        .addSelect('ap.status', 'status')
        .addSelect('ap.appointment_code', 'appointmentCode')
        .addSelect('COALESCE(ap.checkin_at, ap.scheduled_at)', 'lastVisitAt')
        .where('ap.user_id = :saleId', { saleId })
        .andWhere('ap.customer_code IN (:...chunk)', { chunk })
        .andWhere('ap.mapping_status = :matched', { matched: 'matched' })
        .andWhere('ap.status IN (:...statuses)', {
          statuses: ['approved', 'checked_in', 'completed'],
        })
        .andWhere('COALESCE(ap.checkin_at, ap.scheduled_at) >= :from', {
          from: `${from} 00:00:00`,
        })
        .andWhere('COALESCE(ap.checkin_at, ap.scheduled_at) <= :to', {
          to: `${to} 23:59:59`,
        })
        .orderBy('COALESCE(ap.checkin_at, ap.scheduled_at)', 'DESC')
        .getRawMany<{
          customerCode: string;
          status: string;
          appointmentCode: string;
          lastVisitAt: string;
        }>();
      for (const row of rows) {
        if (result.has(row.customerCode)) continue;
        result.set(row.customerCode, {
          lastVisitAt: row.lastVisitAt ?? null,
          status: row.status ?? null,
          appointmentCode: row.appointmentCode ?? null,
        });
      }
    }
    return result;
  }

  private async loadQuotes(
    saleId: number,
    assignmentIds: number[],
    from: string,
    to: string,
  ): Promise<
    Map<number, { count: number; amount: number; lastQuoteAt: Date | null }>
  > {
    const result = new Map<
      number,
      { count: number; amount: number; lastQuoteAt: Date | null }
    >();
    if (assignmentIds.length === 0) return result;

    // contact_id -> assignment_id (cùng một sale; trùng thì lấy assignment nhỏ)
    const links = await this.customerZaloRepo.find({
      where: {
        assignment_id: In(assignmentIds),
        is_active: true,
      },
      select: ['assignment_id', 'zalo_contact_id'],
    });
    const assignmentByContact = new Map<string, number>();
    for (const link of links) {
      const contact = String(link.zalo_contact_id ?? '').trim();
      if (!contact) continue;
      const current = assignmentByContact.get(contact);
      if (current === undefined || link.assignment_id < current) {
        assignmentByContact.set(contact, link.assignment_id);
      }
    }
    if (assignmentByContact.size === 0) return result;

    const toExclusive = `${shiftDateStr(to, 1)} 00:00:00`;
    const rows = await this.orderDetailRepo
      .createQueryBuilder('od')
      .innerJoin(Order, 'o', 'o.id = od.order_id')
      .select('od.meta_customer_id', 'contactId')
      .addSelect('od.unit_price', 'unitPrice')
      .addSelect('od.quantity', 'quantity')
      .addSelect('od.created_at', 'createdAt')
      .where('o.sale_by = :saleId', { saleId })
      .andWhere('od.meta_customer_id IS NOT NULL')
      .andWhere('od.deleted_at IS NULL')
      .andWhere('od.hidden_at IS NULL')
      .andWhere('od.meta_is_group = 0')
      .andWhere('od.status IN (:...statuses)', {
        statuses: [OrderDetailStatus.QUOTED, OrderDetailStatus.CARED],
      })
      .andWhere('od.created_at >= :from', { from: `${from} 00:00:00` })
      .andWhere('od.created_at < :toExclusive', { toExclusive })
      .getRawMany<{
        contactId: string;
        unitPrice: string;
        quantity: string;
        createdAt: Date | string;
      }>();

    for (const row of rows) {
      const contact = String(row.contactId ?? '').trim();
      const assignmentId = assignmentByContact.get(contact);
      if (assignmentId === undefined) continue;
      const current = result.get(assignmentId) ?? {
        count: 0,
        amount: 0,
        lastQuoteAt: null,
      };
      current.count += 1;
      current.amount +=
        (Number(row.unitPrice) || 0) * (Number(row.quantity) || 0);
      const createdAt =
        row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
      if (
        !Number.isNaN(createdAt.getTime()) &&
        (!current.lastQuoteAt || createdAt > current.lastQuoteAt)
      ) {
        current.lastQuoteAt = createdAt;
      }
      result.set(assignmentId, current);
    }
    return result;
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import {
  KpiSlaViolation,
  KpiSlaWaiveSource,
} from './kpi-sla-violation.entity';
import { KpiSlaResponseType } from './kpi-sla-interval.entity';
import { KpiAppeal, KpiAppealStatus } from './kpi-appeal.entity';
import { KpiScopeService, KpiUser } from './kpi-scope.service';
import { KpiSaleDirectoryService } from './kpi-sale-directory.service';
import { KpiCustomerNamesService } from './kpi-customer-names.service';
import { ZaloPythonApiClient } from './zalo-python-api.client';
import { slaDelayMinutes } from './kpi-sla-delay';
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
  private readonly logger = new Logger(KpiSlaService.name);

  constructor(
    @InjectRepository(KpiSlaViolation)
    private readonly violationRepo: Repository<KpiSlaViolation>,
    @InjectRepository(KpiAppeal)
    private readonly appealRepo: Repository<KpiAppeal>,
    private readonly customerNames: KpiCustomerNamesService,
    private readonly scope: KpiScopeService,
    private readonly saleDirectory: KpiSaleDirectoryService,
    private readonly zaloApi: ZaloPythonApiClient,
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
    const waivedByIds = [
      ...new Set(
        rows
          .map((row) => row.waived_by)
          .filter((id): id is number => id !== null && id !== undefined),
      ),
    ];
    const infos = await this.saleDirectory.loadSaleInfos([
      ...new Set([...rows.map((row) => row.sale_id), ...waivedByIds]),
    ]);
    const customerNames = await this.customerNames.load([
      ...new Set(rows.map((row) => row.customer_code)),
    ]);
    const previews = await this.loadInboundPreviews(rows);
    const appeals = rows.length
      ? await this.appealRepo.find({
          where: { violation_id: In(rows.map((row) => row.id)) },
          order: { created_at: 'DESC' },
        })
      : [];
    const appealByViolation = new Map<string, KpiAppeal>();
    for (const appeal of appeals) {
      const key = String(appeal.violation_id);
      if (!appealByViolation.has(key)) appealByViolation.set(key, appeal);
    }
    return {
      period,
      total,
      page,
      limit,
      items: rows.map((row) => {
        const appeal = appealByViolation.get(String(row.id));
        const approved = appeal?.status === KpiAppealStatus.APPROVED;
        const preview = previews.get(String(row.first_inbound_message_id));
        return {
          ...row,
          saleName: infos.get(row.sale_id)?.fullName ?? null,
          customerName: customerNames.get(row.customer_code) ?? null,
          delay_minutes: slaDelayMinutes(row),
          appeal_status: appeal?.status ?? 'none',
          waive_reason: row.is_waived
            ? (row.waive_reason ?? (approved ? appeal.reason : null))
            : null,
          waived_at: row.is_waived
            ? (row.waived_at ?? (approved ? appeal.reviewed_at : null))
            : null,
          waived_by_name:
            row.is_waived && row.waived_by
              ? (infos.get(row.waived_by)?.fullName ?? null)
              : null,
          /** appeal = duyệt khiếu nại; admin = admin hủy thủ công. */
          waive_source: row.is_waived
            ? (row.waive_source ??
              (approved ? 'appeal' : row.waived_by ? 'admin' : null))
            : null,
          first_inbound_content: preview?.content ?? null,
          first_inbound_content_type: preview?.contentType ?? null,
          first_inbound_sender_name: preview?.senderName ?? null,
          first_inbound_content_truncated: preview?.truncated ?? false,
        };
      }),
    };
  }

  /**
   * Tin nhắn Zalo lưu `content` dạng JSON (`{"text": ...}`, media có
   * `caption`/`title`). Chỉ trả phần chữ để FE hiển thị, không trả JSON thô.
   */
  private normalizeMessageContent(content: unknown): string {
    if (typeof content !== 'string') return '';
    const raw = content.trim();
    if (!raw.startsWith('{')) return raw;
    try {
      let data: any = JSON.parse(raw);
      if (typeof data === 'string') return data;
      if (!data || typeof data !== 'object') return raw;
      for (const key of [
        'text',
        'caption',
        'title',
        'description',
        'address',
        'name',
        'displayName',
      ]) {
        const value = data[key];
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return '';
    } catch {
      return raw;
    }
  }

  /**
   * Nội dung tin khách gửi đầu tiên của từng vi phạm (trích đoạn ≤ 500 ký tự).
   *
   * Gọi API Python theo lô id. Lỗi API Python không được làm hỏng danh sách
   * vi phạm — chỉ log và trả `null` cho phần nội dung.
   */
  private async loadInboundPreviews(
    rows: KpiSlaViolation[],
  ): Promise<
    Map<
      string,
      {
        content: string | null;
        contentType: string | null;
        senderName: string | null;
        truncated: boolean;
      }
    >
  > {
    const result = new Map<
      string,
      {
        content: string | null;
        contentType: string | null;
        senderName: string | null;
        truncated: boolean;
      }
    >();
    const ids = [
      ...new Set(
        rows
          .map((row) => row.first_inbound_message_id)
          .filter((id) => id !== null && id !== undefined),
      ),
    ];
    if (ids.length === 0) return result;
    try {
      const messages = await this.zaloApi.getMessagesByIds(ids, 5000);
      for (const message of messages) {
        const key = String(message?.id ?? '');
        if (!key) continue;
        const raw =
          typeof message?.content === 'string' ? message.content.trim() : '';
        const truncated = raw.length > 500;
        result.set(key, {
          content: raw ? (truncated ? `${raw.slice(0, 500)}…` : raw) : null,
          contentType: message?.content_type ?? null,
          senderName: message?.sender_name ?? null,
          truncated,
        });
      }
    } catch (error: any) {
      this.logger.warn(
        `Không tải được nội dung tin nhắn vi phạm SLA: ${error?.message ?? error}`,
      );
    }
    return result;
  }

  /**
   * Toàn bộ tin nhắn quanh thời điểm vi phạm để sale/admin đọc ngữ cảnh.
   *
   * Khung mặc định: trước tin khách 15 phút → sau phản hồi (hoặc hạn SLA + 2h)
   * 15 phút, tối đa 100 tin. Chỉ người trong phạm vi được xem vi phạm đó.
   */
  async getMessagesForViolation(
    id: number,
    user: KpiUser,
    limit = 100,
  ): Promise<any> {
    const row = await this.violationRepo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Không tìm thấy vi phạm SLA');
    }
    this.scope.assertSaleInScope(
      row.sale_id,
      await this.scope.scopeUserIds(user),
    );

    const empty = {
      violationId: row.id,
      conversationId: row.conversation_id ?? null,
      inboundTime: row.inbound_time,
      slaDeadline: row.sla_deadline,
      respondedTime: row.responded_time,
      firstInboundMessageId: row.first_inbound_message_id,
      messages: [] as any[],
      totalCount: 0,
    };
    if (!row.conversation_id) return empty;

    const inbound = new Date(row.inbound_time).getTime();
    if (!Number.isFinite(inbound)) return empty;
    const responded = row.responded_time
      ? new Date(row.responded_time).getTime()
      : null;
    const endBase =
      responded && responded > inbound
        ? Math.min(responded, inbound + 24 * 60 * 60 * 1000)
        : inbound + 2 * 60 * 60 * 1000;
    const fromTs = new Date(inbound - 15 * 60 * 1000).toISOString();
    const toTs = new Date(endBase + 15 * 60 * 1000).toISOString();

    const { items, totalCount } = await this.zaloApi.getConversationMessages({
      conversationId: Number(row.conversation_id),
      fromTs,
      toTs,
      limit: Math.min(200, Math.max(1, Number(limit) || 100)),
      sortOrder: 'asc',
    });

    return {
      ...empty,
      totalCount,
      messages: items.map((message) => ({
        id: message?.id ?? null,
        content: this.normalizeMessageContent(message?.content),
        content_type: message?.content_type ?? 'TEXT',
        timestamp: message?.timestamp ?? null,
        is_outgoing: !!message?.is_outgoing,
        sender_name: message?.sender?.name ?? null,
      })),
    };
  }

  /**
   * Admin miễn / bỏ miễn vi phạm thủ công (SLA ghi nhận sai, khách gọi điện...).
   *
   * Chỉ admin. Miễn thủ công bắt buộc có lý do và ghi đè kết quả khiếu nại
   * (nếu có) — báo cáo KPI đọc `is_waived` nên có hiệu lực ngay.
   */
  async setWaived(
    id: number,
    input: { waived: boolean; reason?: string },
    user: KpiUser,
  ): Promise<any> {
    if (!this.scope.roleNames(user).includes('admin')) {
      throw new ForbiddenException('Chỉ admin được hủy/miễn vi phạm SLA');
    }
    const row = await this.violationRepo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Không tìm thấy vi phạm SLA');
    }

    if (input.waived) {
      const reason = (input.reason ?? '').trim();
      if (reason.length < 3) {
        throw new BadRequestException(
          'Cần nhập lý do hủy vi phạm (ít nhất 3 ký tự)',
        );
      }
      row.is_waived = true;
      row.waived_by = user.id ?? null;
      row.waive_source = KpiSlaWaiveSource.ADMIN;
      row.waive_reason = reason.slice(0, 500);
      row.waived_at = new Date();
    } else {
      row.is_waived = false;
      row.waived_by = null;
      row.waive_source = null;
      row.waive_reason = null;
      row.waived_at = null;
    }
    await this.violationRepo.save(row);
    return {
      id: row.id,
      is_waived: row.is_waived,
      waived_by: row.waived_by,
      waive_source: row.waive_source,
      waive_reason: row.waive_reason,
      waived_at: row.waived_at,
    };
  }

  /** Escape ký tự đại diện để `%`/`_` người dùng gõ không thành wildcard. */
  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
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

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KpiAppeal, KpiAppealStatus } from './kpi-appeal.entity';
import {
  KpiSlaViolation,
  KpiSlaWaiveSource,
} from './kpi-sla-violation.entity';
import { KpiScopeService, KpiUser } from './kpi-scope.service';
import { KpiSaleDirectoryService } from './kpi-sale-directory.service';
import { KpiCustomerNamesService } from './kpi-customer-names.service';
import { slaDelayMinutes } from './kpi-sla-delay';
import { vnToday } from './vn-date';

export interface CreateKpiAppealInput {
  violationId: number;
  reason: string;
  evidenceUrls?: string[];
}

export interface KpiAppealQuery {
  period?: string;
  saleId?: number;
  status?: KpiAppealStatus;
  /** Khớp một phần tên/mã sale, tên/mã khách, tên Zalo hoặc lý do. */
  search?: string;
  /** Chỉ phân trang khi truyền một trong hai; bỏ trống = trả toàn bộ kỳ. */
  page?: number;
  limit?: number;
}

export interface ReviewKpiAppealInput {
  status: KpiAppealStatus.APPROVED | KpiAppealStatus.REJECTED;
  reviewNote?: string;
}

/**
 * Khiếu nại vi phạm SLA 2h — chỉ gắn với một dòng `kpi_sla_violations`.
 *
 * Duyệt = set `is_waived=1`; báo cáo KPI đọc trực tiếp cờ này nên có hiệu lực
 * ngay, không cần recompute bảng tháng.
 */
@Injectable()
export class KpiAppealService {
  constructor(
    @InjectRepository(KpiAppeal)
    private readonly appealRepo: Repository<KpiAppeal>,
    @InjectRepository(KpiSlaViolation)
    private readonly violationRepo: Repository<KpiSlaViolation>,
    private readonly scope: KpiScopeService,
    private readonly saleDirectory: KpiSaleDirectoryService,
    private readonly customerNames: KpiCustomerNamesService,
  ) {}

  private normalizePeriod(period?: string): string {
    const value = period ?? vnToday().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      throw new BadRequestException('period phải có dạng YYYY-MM');
    }
    return value;
  }

  async create(input: CreateKpiAppealInput, user: KpiUser): Promise<any> {
    const violation = await this.violationRepo.findOne({
      where: { id: input.violationId },
    });
    if (!violation) {
      throw new NotFoundException('Không tìm thấy vi phạm SLA');
    }
    const userIds = await this.scope.scopeUserIds(user);
    this.scope.assertSaleInScope(violation.sale_id, userIds);
    if (violation.is_waived) {
      throw new BadRequestException('Vi phạm này đã được miễn');
    }
    // Hạn gửi: hết ngày 05 tháng sau của kỳ vi phạm. Admin được gửi bổ sung
    // sau hạn (giống nút bypass trên FE); role khác bị chặn.
    const deadline = this.appealDeadline(violation.period);
    if (vnToday() > deadline && !this.scope.roleNames(user).includes('admin')) {
      throw new BadRequestException(
        `Đã quá hạn gửi giải trình (hạn ${deadline}). Vui lòng liên hệ admin.`,
      );
    }

    const existing = await this.appealRepo.findOne({
      where: {
        violation_id: violation.id,
        status: In([KpiAppealStatus.PENDING, KpiAppealStatus.APPROVED]),
      },
    });
    if (existing) {
      throw new BadRequestException(
        'Vi phạm này đã có khiếu nại đang xử lý hoặc đã được duyệt',
      );
    }

    const appeal = this.appealRepo.create({
      sale_id: violation.sale_id,
      customer_code: violation.customer_code,
      violation_id: violation.id,
      metric_code: 'sla_phan_hoi_2h',
      period: violation.period,
      reason: input.reason,
      evidence_urls: input.evidenceUrls ?? null,
      status: KpiAppealStatus.PENDING,
    });
    const saved = await this.appealRepo.save(appeal);
    return { ...saved, violation };
  }

  async list(query: KpiAppealQuery, user: KpiUser): Promise<any> {
    const period = this.normalizePeriod(query.period);
    const userIds = await this.scope.scopeUserIds(user);
    if (query.saleId !== undefined) {
      this.scope.assertSaleInScope(query.saleId, userIds);
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
    const paged = query.page !== undefined || query.limit !== undefined;

    if (userIds !== undefined && userIds.length === 0) {
      return {
        period,
        total: 0,
        page: paged ? page : 1,
        limit: paged ? limit : 0,
        totalPages: 1,
        counts: { all: 0, pending: 0, approved: 0, rejected: 0 },
        items: [],
      };
    }

    const search = query.search?.trim();
    const applyCommonFilters = (q: any) => {
      q.where('a.period = :period', { period });
      if (query.saleId !== undefined) {
        q.andWhere('a.sale_id = :saleId', { saleId: query.saleId });
      } else if (userIds !== undefined) {
        q.andWhere('a.sale_id IN (:...userIds)', { userIds });
      }
      if (search) {
        q.andWhere(
          `(
            a.sale_id IN (
              SELECT u.id FROM users u
              WHERE u.deleted_at IS NULL
                AND (u.full_name LIKE :like OR u.employee_code LIKE :like)
            )
            OR a.customer_code IN (
              SELECT c.customer_code FROM customers c
              WHERE c.status <> 'deleted'
                AND (c.customer_code LIKE :like OR c.customer_name LIKE :like)
            )
            OR a.customer_code IN (
              SELECT c2.customer_code
              FROM customer_zalo z
              JOIN customer_assignments ca ON ca.id = z.assignment_id
              JOIN customers c2 ON c2.id = ca.customer_id
              WHERE z.is_active = 1 AND z.matched_name LIKE :like
            )
            OR a.reason LIKE :like
          )`,
          { like: `%${this.escapeLike(search)}%` },
        );
      }
    };

    // Đếm số lượng theo từng status để các tab trên FE luôn hiển thị đúng
    const countQb = this.appealRepo
      .createQueryBuilder('a')
      .select('a.status', 'status')
      .addSelect('COUNT(*)', 'cnt');
    applyCommonFilters(countQb);
    countQb.groupBy('a.status');

    const statusCountsRaw = await countQb.getRawMany();
    const counts = {
      all: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
    };
    for (const sc of statusCountsRaw) {
      const c = Number(sc.cnt) || 0;
      if (sc.status === KpiAppealStatus.PENDING) counts.pending = c;
      else if (sc.status === KpiAppealStatus.APPROVED) counts.approved = c;
      else if (sc.status === KpiAppealStatus.REJECTED) counts.rejected = c;
    }
    counts.all = counts.pending + counts.approved + counts.rejected;

    // Lấy dữ liệu danh sách khiếu nại (áp dụng lọc status và phân trang nếu có)
    const qb = this.appealRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.violation', 'v');
    applyCommonFilters(qb);

    if (query.status) {
      qb.andWhere('a.status = :status', { status: query.status });
    }

    qb.orderBy('a.created_at', 'DESC');
    if (paged) qb.skip((page - 1) * limit).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    const infos = await this.saleDirectory.loadSaleInfos([
      ...new Set(
        rows
          .flatMap((row) => [row.sale_id, row.reviewer_id])
          .filter((id): id is number => id != null),
      ),
    ]);
    const customerNames = await this.customerNames.load([
      ...new Set(rows.map((row) => row.customer_code)),
    ]);
    // FE dùng cờ này để ẩn nút duyệt khi người xem chính là sale của khiếu nại
    // và không phải admin/pm-khach-hang (trưởng phòng không được tự duyệt).
    const canWrite = this.scope.canWriteKpi(user);
    const canReviewAny = this.scope.isAdminOrPm(user);
    return {
      period,
      total,
      page: paged ? page : 1,
      limit: paged ? limit : total,
      totalPages: paged ? Math.ceil(total / limit) || 1 : 1,
      counts,
      items: rows.map((row) => {
        const customerName = customerNames.get(row.customer_code) ?? null;
        return {
          ...row,
          saleName: infos.get(row.sale_id)?.fullName ?? null,
          customerName,
          // FE cũ đọc snake_case; giữ cả hai để không phải sửa ngay.
          customer_name: customerName,
          reviewerName: row.reviewer_id
            ? (infos.get(row.reviewer_id)?.fullName ?? null)
            : null,
          canReview:
            row.status === KpiAppealStatus.PENDING &&
            canWrite &&
            (canReviewAny || Number(row.sale_id) !== Number(user.id)),
          violation: row.violation
            ? {
                ...row.violation,
                delay_minutes: slaDelayMinutes(row.violation),
              }
            : null,
        };
      }),
    };
  }

  /** Hạn gửi giải trình: hết ngày 05 của tháng sau kỳ vi phạm (YYYY-MM-DD). */
  private appealDeadline(period: string): string {
    const [year, month] = period.split('-').map(Number);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-05`;
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
  }

  async review(
    id: number,
    input: ReviewKpiAppealInput,
    user: KpiUser,
  ): Promise<any> {
    if (!this.scope.canWriteKpi(user)) {
      throw new ForbiddenException(
        'Chỉ admin / pm-khach-hang / quản lý phòng được duyệt khiếu nại',
      );
    }
    const appeal = await this.appealRepo.findOne({
      where: { id },
      relations: ['violation'],
    });
    if (!appeal) {
      throw new NotFoundException('Không tìm thấy khiếu nại');
    }
    // Manager chỉ duyệt được khiếu nại của sale thuộc phòng mình.
    this.scope.assertSaleInScope(
      appeal.sale_id,
      await this.scope.scopeUserIds(user),
    );
    // Không cho tự duyệt giải trình của chính mình (trưởng phòng cũng là sale
    // trong KPI). Trường hợp này chỉ PM Khách Hàng hoặc Admin được xử lý.
    if (appeal.status !== KpiAppealStatus.PENDING) {
      throw new BadRequestException('Khiếu nại này đã được xử lý');
    }
    if (
      Number(appeal.sale_id) === Number(user.id) &&
      !this.scope.isAdminOrPm(user)
    ) {
      throw new ForbiddenException(
        'Bạn không thể tự duyệt giải trình của chính mình. Vui lòng chuyển PM Khách Hàng hoặc Admin duyệt.',
      );
    }

    await this.appealRepo.manager.transaction(async (manager) => {
      appeal.status = input.status;
      appeal.reviewer_id = user.id ?? null;
      appeal.review_note = input.reviewNote ?? null;
      appeal.reviewed_at = new Date();
      await manager.save(appeal);

      if (input.status === KpiAppealStatus.APPROVED) {
        appeal.violation.is_waived = true;
        appeal.violation.waived_by = user.id ?? null;
        appeal.violation.waive_source = KpiSlaWaiveSource.APPEAL;
        appeal.violation.waive_reason = appeal.reason;
        appeal.violation.waived_at = appeal.reviewed_at;
        await manager.save(appeal.violation);
      }
    });

    return this.appealRepo.findOne({
      where: { id },
      relations: ['violation'],
    });
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KpiAppeal, KpiAppealStatus } from './kpi-appeal.entity';
import { KpiSlaViolation } from './kpi-sla-violation.entity';
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
        items: [],
      };
    }

    const qb = this.appealRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.violation', 'v')
      .where('a.period = :period', { period });
    if (query.saleId !== undefined) {
      qb.andWhere('a.sale_id = :saleId', { saleId: query.saleId });
    } else if (userIds !== undefined) {
      qb.andWhere('a.sale_id IN (:...userIds)', { userIds });
    }
    if (query.status) {
      qb.andWhere('a.status = :status', { status: query.status });
    }

    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
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
    return {
      period,
      total,
      page: paged ? page : 1,
      limit: paged ? limit : total,
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
    if (appeal.status !== KpiAppealStatus.PENDING) {
      throw new BadRequestException('Khiếu nại này đã được xử lý');
    }

    await this.appealRepo.manager.transaction(async (manager) => {
      appeal.status = input.status;
      appeal.reviewer_id = user.id ?? null;
      appeal.review_note = input.reviewNote ?? null;
      appeal.reviewed_at = new Date();
      await manager.save(appeal);

      if (input.status === KpiAppealStatus.APPROVED) {
        appeal.violation.is_waived = true;
        await manager.save(appeal.violation);
      }
    });

    return this.appealRepo.findOne({
      where: { id },
      relations: ['violation'],
    });
  }
}

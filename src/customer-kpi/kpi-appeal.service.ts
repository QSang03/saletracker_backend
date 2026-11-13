import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
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

    const where: FindOptionsWhere<KpiAppeal> = { period };
    if (query.saleId !== undefined) {
      where.sale_id = query.saleId;
    } else if (userIds !== undefined) {
      if (userIds.length === 0) return { period, total: 0, items: [] };
      where.sale_id = In(userIds);
    }
    if (query.status) {
      where.status = query.status;
    }

    const [rows, total] = await this.appealRepo.findAndCount({
      where,
      relations: ['violation'],
      order: { created_at: 'DESC' },
    });
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
      items: rows.map((row) => ({
        ...row,
        saleName: infos.get(row.sale_id)?.fullName ?? null,
        customerName: customerNames.get(row.customer_code) ?? null,
        reviewerName: row.reviewer_id
          ? (infos.get(row.reviewer_id)?.fullName ?? null)
          : null,
        violation: row.violation
          ? { ...row.violation, delay_minutes: slaDelayMinutes(row.violation) }
          : null,
      })),
    };
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

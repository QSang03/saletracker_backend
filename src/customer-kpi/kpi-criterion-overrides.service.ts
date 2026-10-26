import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { CustomerAssignment } from './customer-assignment.entity';
import {
  ForcedStatus,
  KpiCriterionOverride,
} from './kpi-criterion-overrides.entity';
import { REVENUE_TARGET_CRITERION_KEYS } from './customer-kpi-targets.service';
import {
  KpiCriterionOverrideQueryDto,
  CreateKpiCriterionOverrideDto,
} from './dto/kpi-criterion-overrides.dto';

/**
 * Ghi đè thủ công tiêu chí 3/4 của quản lý. Khác approval_requests: quản lý
 * (trưởng phòng cùng phòng hoặc admin) ghi TRỰC TIẾP, không qua luồng duyệt —
 * dùng khi khách báo cáo xấu rằng sale làm không tốt, ép tiêu chí thành
 * "chưa đạt" bất chấp engine tính. Sale (user-khach-hang) chặn — không cho tự
 * hạ KPI của mình. Mọi thay đổi có trigger ghi database_change_log.
 */
@Injectable()
export class KpiCriterionOverridesService {
  constructor(
    @InjectRepository(KpiCriterionOverride)
    private readonly overrideRepo: Repository<KpiCriterionOverride>,
    @InjectRepository(CustomerAssignment)
    private readonly assignmentRepo: Repository<CustomerAssignment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** Danh sách override trong phạm vi người xem (cùng luật phạm vi báo cáo). */
  async list(query: KpiCriterionOverrideQueryDto, user: any) {
    const where: Record<string, unknown> = {};
    const userIds = await this.scopeUserIds(user);
    if (userIds !== undefined) {
      if (userIds.length === 0) return { data: [], total: 0 };
      where.sale_id = In(userIds);
    }
    if (query.saleId !== undefined) {
      // saleId lọc thêm TRONG phạm vi — không được dùng để nhìn ra ngoài
      if (userIds !== undefined && !userIds.includes(query.saleId)) {
        throw new ForbiddenException('Bạn không có quyền xem sale này');
      }
      where.sale_id = query.saleId;
    }
    if (query.criterionKey) where.criterion_key = query.criterionKey;
    if (query.periodMonth) where.period_month = query.periodMonth;
    const data = await this.overrideRepo.find({
      where,
      order: { period_month: 'DESC', id: 'DESC' },
    });
    return { data, total: data.length };
  }

  /** Tạo/cập nhật override (upsert theo UNIQUE). Chỉ ép về "chưa đạt". */
  async create(dto: CreateKpiCriterionOverrideDto, user: any) {
    const saleId = Number(dto.sale_id);
    const customerId = dto.customer_id ?? 0;
    await this.assertCanOverrideSale(saleId, user);
    // Tiêu chí doanh số không cho ghi đè tay: số tiền lấy từ API NKM, ghi đè sẽ
    // mâu thuẫn với nguồn chân lý (thiết kế §5.4). Ghi đè vẫn dành cho TC3 +
    // TC4. Sau này nếu ép "khách KEY không đạt" thì mở rộng đúng danh sách này.
    if (REVENUE_TARGET_CRITERION_KEYS.includes(dto.criterion_key)) {
      throw new BadRequestException(
        `Tiêu chí doanh số "${dto.criterion_key}" lấy từ API NKM, không ghi đè thủ công`,
      );
    }
    if (customerId > 0) {
      const assignment = await this.assignmentRepo.findOne({
        where: { sale_id: saleId, customer_id: customerId },
      });
      if (!assignment) {
        throw new BadRequestException(
          'Khách hàng này không thuộc danh sách của sale',
        );
      }
    }
    const existing = await this.overrideRepo.findOne({
      where: {
        criterion_key: dto.criterion_key,
        period_month: dto.period_month,
        sale_id: saleId,
        customer_id: customerId,
      },
    });
    if (existing) {
      existing.reason = dto.reason.trim();
      existing.created_by = user.id;
      return this.overrideRepo.save(existing);
    }
    return this.overrideRepo.save(
      this.overrideRepo.create({
        criterion_key: dto.criterion_key,
        period_month: dto.period_month,
        sale_id: saleId,
        customer_id: customerId,
        forced_status: ForcedStatus.FAIL,
        reason: dto.reason.trim(),
        created_by: user.id,
      }),
    );
  }

  /** Bỏ override — engine hiện lại kết quả thật ở lần tải báo cáo kế tiếp. */
  async remove(id: number, user: any) {
    const row = await this.overrideRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy bản ghi ghi đè');
    await this.assertCanOverrideSale(row.sale_id, user);
    await this.overrideRepo.remove(row);
    return { deleted: true };
  }

  // ---------------------------------------------------- phạm vi + quyền

  /** admin/PM/view toàn công ty; manager theo phòng; user chỉ mình. */
  private async scopeUserIds(user: any): Promise<number[] | undefined> {
    if (!user?.id) {
      throw new ForbiddenException('Không xác định được người dùng');
    }
    const roles = this.roleNames(user);
    if (
      roles.includes('admin') ||
      roles.includes('view') ||
      roles.includes('pm-khach-hang')
    ) {
      return undefined;
    }
    if (roles.some((r) => r.startsWith('manager-'))) {
      return this.userIdsInDepartments(user);
    }
    return [user.id];
  }

  /**
   * Chỉ quản lý (trưởng phòng) hoặc quản trị viên được ghi đè; trưởng phòng
   * chỉ ghi đè được sale CÙNG PHÒNG (mẫu sharesDepartmentWith của
   * approval-requests.service).
   */
  private async assertCanOverrideSale(saleId: number, user: any) {
    const roles = this.roleNames(user);
    if (
      !roles.includes('admin') &&
      !roles.some((r) => r.startsWith('manager-'))
    ) {
      throw new ForbiddenException(
        'Chỉ quản lý (trưởng phòng) hoặc quản trị viên mới được ghi đè tiêu chí',
      );
    }
    if (roles.includes('admin')) return;
    const departmentIds = (user.departments || [])
      .map((d: any) => d?.id)
      .filter(Boolean);
    if (departmentIds.length === 0) {
      throw new ForbiddenException(
        'Chỉ trưởng phòng của sale này mới được ghi đè tiêu chí',
      );
    }
    const found = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin('u.departments', 'd')
      .where('u.id = :saleId', { saleId })
      .andWhere('d.id IN (:...departmentIds)', { departmentIds })
      .andWhere('u.deletedAt IS NULL')
      .getOne();
    if (!found) {
      throw new ForbiddenException(
        'Chỉ trưởng phòng của sale này mới được ghi đè tiêu chí',
      );
    }
  }

  private roleNames(user: any): string[] {
    return (user?.roles || []).map((r: any) =>
      (typeof r === 'string' ? r : r?.name || '').toLowerCase(),
    );
  }

  private async userIdsInDepartments(user: any): Promise<number[]> {
    const departmentIds = (user.departments || [])
      .map((d: any) => d?.id)
      .filter(Boolean);
    if (departmentIds.length === 0) return [];
    const users = await this.userRepo
      .createQueryBuilder('user')
      .leftJoin('user.departments', 'dept')
      .where('dept.id IN (:...departmentIds)', { departmentIds })
      .andWhere('user.deletedAt IS NULL')
      .getMany();
    return users.map((u) => u.id);
  }
}

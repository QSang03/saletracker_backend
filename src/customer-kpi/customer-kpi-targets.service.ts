import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Customer } from './customer.entity';
import { CustomerAssignment } from './customer-assignment.entity';
import { KpiDefinition, ScoringMode } from './kpi-definition.entity';
import { KpiTarget } from './kpi-target.entity';
import {
  ApprovalRequest,
  ApprovalRequestType,
  ApprovalStatus,
} from './approval-request.entity';
import { ApprovalRequestTargetItem } from './approval-request-target-item.entity';
import { AssignKpiTargetsDto, KpiTargetQueryDto } from './dto/kpi-target.dto';

const roleNames = (user: any): string[] =>
  (user?.roles || []).map((r: any) =>
    (typeof r === 'string' ? r : r?.name || '').toLowerCase(),
  );

interface TargetRow {
  saleId: number;
  customerId: number;
  targetValue: number;
}

/**
 * Tiêu chí doanh số — nguồn chân lý là API NKM nên KHÔNG nhập tay (thiết kế
 * §5.4, §7). Dùng chung cho cả API giao chỉ tiêu và luồng trưởng phòng đề xuất
 * chờ duyệt (`approval_requests` loại `kpi_target`).
 *
 * Nếu sau này cần ép "khách KEY không đạt" (khách báo cáo xấu), thêm các mã này
 * vào `OVERRIDABLE_CRITERION_KEYS` của module ghi đè — mở rộng đúng một chỗ.
 */
export const REVENUE_TARGET_CRITERION_KEYS = ['doanh_so_key', 'doanh_so_non'];

/**
 * Chỉ tiêu theo tháng. Danh sách đã làm hôm nay; LUỒNG GÁN (cả ba cách gán +
 * luồng trưởng phòng đề xuất -> admin duyệt) thuộc Mục 4 — công việc con 4.
 */
@Injectable()
export class CustomerKpiTargetsService {
  constructor(
    @InjectRepository(KpiTarget)
    private readonly targetRepo: Repository<KpiTarget>,
    @InjectRepository(KpiDefinition)
    private readonly definitionRepo: Repository<KpiDefinition>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CustomerAssignment)
    private readonly assignmentRepo: Repository<CustomerAssignment>,
    @InjectRepository(ApprovalRequest)
    private readonly requestRepo: Repository<ApprovalRequest>,
    @InjectRepository(ApprovalRequestTargetItem)
    private readonly targetItemRepo: Repository<ApprovalRequestTargetItem>,
  ) {}

  /**
   * Phạm vi xem chỉ tiêu: admin/pm-khach-hang xem hết; manager xem người trong
   * phòng mình; user chỉ xem của mình. Role 'pm' đơn lẻ không tự động thấy
   * toàn công ty. KHÔNG dùng resolveScope ở đây vì quy tắc 'analysis' của
   * trang báo cáo không áp dụng cho màn hình quản trị chỉ tiêu.
   */
  private async scopeUserIds(user: any): Promise<number[] | undefined> {
    const roles = roleNames(user);
    if (roles.includes('admin') || roles.includes('pm-khach-hang')) {
      return undefined;
    }

    if (roles.some((r) => r.startsWith('manager-'))) {
      return this.managerScopeSaleIds(user);
    }
    return [user.id];
  }

  /** Các sale thuộc phòng ban của trưởng phòng (phục vụ gán + duyệt). */
  private async managerScopeSaleIds(user: any): Promise<number[]> {
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

  async list(query: KpiTargetQueryDto, user: any) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;

    const userIds = await this.scopeUserIds(user);
    if (userIds !== undefined && userIds.length === 0) {
      return { data: [], total: 0, page, pageSize };
    }

    const qb = this.targetRepo
      .createQueryBuilder('t')
      .leftJoin('t.sale', 'u')
      .addSelect(['u.id', 'u.fullName', 'u.employeeCode']);

    if (userIds !== undefined) {
      qb.andWhere('t.sale_id IN (:...userIds)', { userIds });
    }
    if (query.criterion_key) {
      qb.andWhere('t.criterion_key = :criterionKey', {
        criterionKey: query.criterion_key,
      });
    }
    if (query.period_month) {
      qb.andWhere('t.period_month = :periodMonth', {
        periodMonth: query.period_month,
      });
    }
    if (query.saleId) {
      qb.andWhere('t.sale_id = :saleId', { saleId: query.saleId });
    }
    if (query.department) {
      // Hợp đồng API hứa filter theo phòng ban — lọc qua phòng của SALE
      qb.andWhere(
        'EXISTS (SELECT 1 FROM users_departments ud ' +
          'INNER JOIN departments d ON d.id = ud.department_id ' +
          'WHERE ud.user_id = t.sale_id AND d.slug = :deptSlug)',
        { deptSlug: query.department },
      );
    }

    qb.orderBy('t.period_month', 'DESC')
      .addOrderBy('t.criterion_key', 'ASC')
      .addOrderBy('t.sale_id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [targets, total] = await qb.getManyAndCount();

    // Điền mã khách hàng cho dòng chỉ tiêu riêng theo khách (customer_id > 0)
    const customerIds = [
      ...new Set(targets.map((t) => t.customer_id).filter((id) => id > 0)),
    ];
    const customers = customerIds.length
      ? await this.customerRepo.find({
          where: { id: In(customerIds) },
          select: ['id', 'customer_code', 'customer_name'],
        })
      : [];
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const data = targets.map((t) => ({
      id: t.id,
      criterionKey: t.criterion_key,
      periodMonth: t.period_month,
      saleId: t.sale_id,
      saleName: (t.sale as any)?.fullName ?? null,
      customerId: t.customer_id > 0 ? t.customer_id : null,
      customerCode:
        t.customer_id > 0
          ? (customerMap.get(t.customer_id)?.customer_code ?? null)
          : null,
      targetValue: t.target_value,
      createdBy: t.created_by,
      createdAt: t.created_at,
    }));

    return { data, total, page, pageSize };
  }

  /**
   * Giao chỉ tiêu — 3 cách gán (mục 5.1.7). Admin áp dụng thẳng; trưởng phòng
   * gán cho người trong phòng mình thì tạo approval_requests (kpi_target) chờ
   * quản trị viên duyệt; nhân viên không được gán.
   *
   * "Gán theo phòng" chỉ là THAO TÁC HÀNG LOẠT tạo dòng cấp nhân viên
   * (customer_id = 0) cho mọi người trong phòng — không phải cấp lưu riêng,
   * tránh chỉ tiêu phòng bị nhân với số khách (mục 5.1.7).
   */
  async assign(dto: AssignKpiTargetsDto, user: any) {
    const roles = roleNames(user);
    const isAdmin = roles.includes('admin');
    const isManager = !isAdmin && roles.some((r) => r.startsWith('manager-'));
    if (!isAdmin && !isManager) {
      throw new ForbiddenException(
        'Chỉ quản trị viên hoặc trưởng phòng mới được giao chỉ tiêu',
      );
    }

    const definition = await this.definitionRepo.findOne({
      where: { key: dto.criterion_key },
    });
    if (!definition || !definition.is_active) {
      throw new NotFoundException(
        `Không tìm thấy tiêu chí "${dto.criterion_key}" hoặc tiêu chí đã tắt`,
      );
    }
    // Tiêu chí doanh số lấy từ API NKM — không cho nhập tay ở BẤT KỲ cấp nào
    // (thiết kế THIET-KE-DOANH-SO-API-NKM.md §5.4, §7). Job đồng bộ ghi thẳng
    // vào `sale_revenue_target`, không đi qua đây nên không bị chặn.
    if (REVENUE_TARGET_CRITERION_KEYS.includes(dto.criterion_key)) {
      throw new BadRequestException(
        `Tiêu chí doanh số "${dto.criterion_key}" lấy từ API NKM, không nhập tay. Chỉ tiêu quý của sale do hệ thống đồng bộ tự động.`,
      );
    }
    if (definition.scoring_mode !== ScoringMode.RATIO) {
      throw new BadRequestException(
        'Chỉ tiêu chỉ gán cho tiêu chí dạng ratio — tiêu chí binary dùng ngưỡng trong cấu hình',
      );
    }

    const rows = await this.resolveRows(dto);

    // Trưởng phòng chỉ gán cho người trong phòng ban của mình
    if (isManager) {
      const allowed = await this.managerScopeSaleIds(user);
      if (rows.some((row) => !allowed.includes(row.saleId))) {
        throw new ForbiddenException(
          'Chỉ được giao chỉ tiêu cho người trong phòng ban của mình',
        );
      }
    }

    if (!isAdmin) {
      return this.createProposal(dto, rows, user);
    }
    return this.applyRows(dto.criterion_key, dto.period_month, rows, user.id);
  }

  private async resolveRows(dto: AssignKpiTargetsDto): Promise<TargetRow[]> {
    if (dto.scope === 'department') {
      if (!dto.department_slug || dto.target_value == null) {
        throw new BadRequestException(
          'Gán theo phòng cần department_slug và target_value',
        );
      }
      const users = await this.userRepo
        .createQueryBuilder('u')
        .innerJoin('users_departments', 'ud', 'ud.user_id = u.id')
        .innerJoin('departments', 'd', 'd.id = ud.department_id')
        .where('d.slug = :slug', { slug: dto.department_slug })
        .andWhere('u.deleted_at IS NULL')
        .getMany();
      if (users.length === 0) {
        throw new NotFoundException(
          `Không có nhân viên nào trong phòng "${dto.department_slug}"`,
        );
      }
      return users.map((u) => ({
        saleId: u.id,
        customerId: 0,
        targetValue: Number(dto.target_value),
      }));
    }

    if (dto.scope === 'sale') {
      if (!dto.sale_ids?.length || dto.target_value == null) {
        throw new BadRequestException(
          'Gán theo nhân viên cần sale_ids[] và target_value',
        );
      }
      return [...new Set(dto.sale_ids)].map((saleId) => ({
        saleId,
        customerId: 0,
        targetValue: Number(dto.target_value),
      }));
    }

    // scope = customer
    if (!dto.sale_id || !dto.items?.length) {
      throw new BadRequestException(
        'Gán theo khách hàng cần sale_id và items[{customer_id, target_value}]',
      );
    }
    const assignments = await this.assignmentRepo.find({
      where: { sale_id: dto.sale_id },
      select: ['customer_id'],
    });
    const owned = new Set(assignments.map((a) => a.customer_id));
    const foreign = dto.items.filter((item) => !owned.has(item.customer_id));
    if (foreign.length > 0) {
      throw new BadRequestException(
        `${foreign.length} khách hàng không thuộc danh sách phân công của sale #${dto.sale_id}`,
      );
    }
    return dto.items.map((item) => ({
      saleId: dto.sale_id!,
      customerId: item.customer_id,
      targetValue: Number(item.target_value),
    }));
  }

  /** Trưởng phòng đề xuất → hàng chờ chờ quản trị viên duyệt (thiết kế 5.2). */
  private async createProposal(
    dto: AssignKpiTargetsDto,
    rows: TargetRow[],
    user: any,
  ) {
    const existing = await this.loadExisting(
      dto.criterion_key,
      dto.period_month,
      rows.map((row) => row.saleId),
    );

    const request = await this.requestRepo.save(
      this.requestRepo.create({
        request_type: ApprovalRequestType.KPI_TARGET,
        requested_by: { id: user.id } as any,
        target_user_id:
          rows.length === 1 && rows[0].customerId === 0 ? rows[0].saleId : null,
        status: ApprovalStatus.PENDING,
        note: `Đề xuất giao chỉ tiêu "${dto.criterion_key}" tháng ${dto.period_month} (${rows.length} dòng)`,
      }),
    );

    await this.targetItemRepo.save(
      rows.map((row) =>
        this.targetItemRepo.create({
          request_id: request.id,
          criterion_key: dto.criterion_key,
          period_month: dto.period_month,
          sale_id: row.saleId,
          customer_id: row.customerId > 0 ? row.customerId : null,
          old_target_value:
            existing.get(`${row.saleId}|${row.customerId}`) ?? null,
          new_target_value: row.targetValue,
        }),
      ),
    );

    return {
      submitted: true,
      requestId: request.id,
      itemCount: rows.length,
      message: 'Đề xuất đã gửi cho quản trị viên duyệt',
    };
  }

  private async loadExisting(
    criterionKey: string,
    periodMonth: string,
    saleIds: number[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (saleIds.length === 0) return map;
    const rows = await this.targetRepo.find({
      where: {
        criterion_key: criterionKey,
        period_month: periodMonth,
        sale_id: In([...new Set(saleIds)]),
      },
    });
    for (const row of rows) {
      map.set(`${row.sale_id}|${row.customer_id}`, Number(row.target_value));
    }
    return map;
  }

  /** Admin áp dụng thẳng: upsert theo UNIQUE(criterion, month, sale, customer). */
  private async applyRows(
    criterionKey: string,
    periodMonth: string,
    rows: TargetRow[],
    createdBy: number,
  ) {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await this.targetRepo.manager
        .createQueryBuilder()
        .insert()
        .into(KpiTarget)
        .values(
          chunk.map((row) => ({
            criterion_key: criterionKey,
            period_month: periodMonth,
            sale_id: row.saleId,
            customer_id: row.customerId,
            target_value: row.targetValue,
            created_by: createdBy,
          })),
        )
        .orUpdate({ overwrite: ['target_value'] })
        .execute();
    }
    return { applied: rows.length };
  }
}

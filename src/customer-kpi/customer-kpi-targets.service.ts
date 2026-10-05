import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Customer } from './customer.entity';
import { KpiTarget } from './kpi-target.entity';
import { AssignKpiTargetsDto, KpiTargetQueryDto } from './dto/kpi-target.dto';

const roleNames = (user: any): string[] =>
  (user?.roles || []).map((r: any) =>
    (typeof r === 'string' ? r : r?.name || '').toLowerCase(),
  );

/**
 * Chỉ tiêu theo tháng. Danh sách đã làm hôm nay; LUỒNG GÁN (cả ba cách gán +
 * luồng trưởng phòng đề xuất -> admin duyệt) thuộc Mục 4 — công việc con 4.
 */
@Injectable()
export class CustomerKpiTargetsService {
  constructor(
    @InjectRepository(KpiTarget)
    private readonly targetRepo: Repository<KpiTarget>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
  ) {}

  /**
   * Phạm vi xem chỉ tiêu: admin/PM xem hết; manager xem người trong phòng
   * mình; user chỉ xem của mình. KHÔNG dùng resolveScope ở đây vì quy tắc
   * 'analysis' của trang báo cáo không áp dụng cho màn hình quản trị chỉ tiêu.
   */
  private async scopeUserIds(user: any): Promise<number[] | undefined> {
    const roles = roleNames(user);
    if (roles.includes('admin') || roles.includes('pm')) return undefined;

    if (roles.some((r) => r.startsWith('manager-'))) {
      const departments: any[] = user.departments || [];
      const departmentIds = departments.map((d) => d?.id).filter(Boolean);
      if (departmentIds.length === 0) return [];
      const users = await this.userRepo
        .createQueryBuilder('user')
        .leftJoin('user.departments', 'dept')
        .where('dept.id IN (:...departmentIds)', { departmentIds })
        .andWhere('user.deletedAt IS NULL')
        .getMany();
      return users.map((u) => u.id);
    }
    return [user.id];
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

    qb.orderBy('t.period_month', 'DESC')
      .addOrderBy('t.criterion_key', 'ASC')
      .addOrderBy('t.sale_id', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [targets, total] = await qb.getManyAndCount();

    // Điền mã khách hàng cho dòng chỉ tiêu riêng theo khách (customer_id > 0)
    const customerIds = [
      ...new Set(
        targets.map((t) => t.customer_id).filter((id) => id > 0),
      ),
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
          ? customerMap.get(t.customer_id)?.customer_code ?? null
          : null,
      targetValue: t.target_value,
      createdBy: t.created_by,
      createdAt: t.created_at,
    }));

    return { data, total, page, pageSize };
  }

  async assign(dto: AssignKpiTargetsDto, user: any) {
    void dto;
    void user;
    throw new NotImplementedException(
      'Giao chỉ tiêu (3 cách gán + luồng trưởng phòng đề xuất chờ admin duyệt) sẽ xây ở Mục 4 (công việc con 4)',
    );
  }
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Customer, CustomerStatus } from './customer.entity';
import { CustomerAssignment, CustomerTier } from './customer-assignment.entity';
import { KpiTarget } from './kpi-target.entity';
import {
  ApprovalRequest,
  ApprovalRequestType,
  ApprovalStatus,
} from './approval-request.entity';
import { ApprovalCustomerAction } from './approval-request-customer-item.entity';
import { ApprovalRequestCustomerItem } from './approval-request-customer-item.entity';
import { ApprovalRequestTargetItem } from './approval-request-target-item.entity';
import {
  ApprovalRequestQueryDto,
  DecideApprovalDto,
} from './dto/approval-request.dto';

const isAdmin = (user: any) =>
  Array.isArray(user?.roles) &&
  user.roles.some(
    (r: any) => (typeof r === 'string' ? r : r?.name) === 'admin',
  );

/**
 * Hàng chờ duyệt dùng chung cho hai luồng:
 * - customer_list: nhân viên đề xuất sửa danh sách -> trưởng phòng duyệt
 * - kpi_target   : trưởng phòng đề xuất chỉ tiêu -> admin duyệt
 * Xem danh sách + chi tiết đã làm hôm nay; QUYẾT ĐỊNH duyệt/từ chối (ghi vào
 * customer_assignments / kpi_targets + nhật ký) thuộc Mục 2 (cv 6) và Mục 4 (cv 4).
 */
@Injectable()
export class ApprovalRequestsService {
  constructor(
    @InjectRepository(ApprovalRequest)
    private readonly requestRepo: Repository<ApprovalRequest>,
    @InjectRepository(ApprovalRequestCustomerItem)
    private readonly customerItemRepo: Repository<ApprovalRequestCustomerItem>,
    @InjectRepository(ApprovalRequestTargetItem)
    private readonly targetItemRepo: Repository<ApprovalRequestTargetItem>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CustomerAssignment)
    private readonly assignmentRepo: Repository<CustomerAssignment>,
    @InjectRepository(KpiTarget)
    private readonly kpiTargetRepo: Repository<KpiTarget>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Phạm vi nhìn hàng chờ duyệt: admin/PM/view toàn công ty; manager thấy
   * đề xuất CỦA người trong phòng mình (để duyệt); còn lại chỉ của mình.
   */
  private async visibleUserIds(user: any): Promise<number[] | undefined> {
    const roles = (user?.roles || []).map((r: any) =>
      (typeof r === 'string' ? r : r?.name || '').toLowerCase(),
    );
    if (
      roles.includes('admin') ||
      roles.includes('pm') ||
      roles.includes('view') ||
      roles.some((r) => r.startsWith('pm-'))
    ) {
      return undefined;
    }
    if (roles.some((r) => r.startsWith('manager-'))) {
      const departmentIds = (user?.departments || [])
        .map((d: any) => d?.id)
        .filter(Boolean);
      if (!departmentIds.length) return [];
      const users = await this.userRepo
        .createQueryBuilder('u')
        .leftJoin('u.departments', 'd')
        .where('d.id IN (:...departmentIds)', { departmentIds })
        .andWhere('u.deletedAt IS NULL')
        .getMany();
      return users.map((u) => u.id);
    }
    return [user.id];
  }

  async list(query: ApprovalRequestQueryDto, user: any) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const qb = this.requestRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.requested_by', 'u');

    const visibleIds = await this.visibleUserIds(user);
    if (visibleIds !== undefined) {
      if (visibleIds.length === 0) {
        return { data: [], total: 0, page, pageSize };
      }
      // manager: thấy đề xuất do mình gửi hoặc nhắm tới người trong phòng
      qb.andWhere(
        '(r.requested_by IN (:...visibleIds) OR r.target_user_id IN (:...visibleIds))',
        {
          visibleIds,
        },
      );
    }
    if (query.request_type) {
      qb.andWhere('r.request_type = :requestType', {
        requestType: query.request_type,
      });
    }
    if (query.status) {
      qb.andWhere('r.status = :status', { status: query.status });
    }

    qb.orderBy('r.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [requests, total] = await qb.getManyAndCount();

    // Đếm số mục trong từng đề xuất để FE hiển thị cột "số thay đổi"
    const requestIds = requests.map((r) => r.id);
    const counts = new Map<number, number>();
    if (requestIds.length) {
      const customerCounts = await this.customerItemRepo
        .createQueryBuilder('i')
        .select('i.request_id', 'request_id')
        .addSelect('COUNT(*)', 'cnt')
        .where('i.request_id IN (:...requestIds)', { requestIds })
        .groupBy('i.request_id')
        .getRawMany();
      const targetCounts = await this.targetItemRepo
        .createQueryBuilder('i')
        .select('i.request_id', 'request_id')
        .addSelect('COUNT(*)', 'cnt')
        .where('i.request_id IN (:...requestIds)', { requestIds })
        .groupBy('i.request_id')
        .getRawMany();
      for (const row of [...customerCounts, ...targetCounts]) {
        counts.set(
          Number(row.request_id),
          (counts.get(Number(row.request_id)) ?? 0) + Number(row.cnt),
        );
      }
    }

    const data = requests.map((r) => ({
      id: r.id,
      requestType: r.request_type,
      status: r.status,
      requestedBy: {
        id: r.requested_by?.id,
        fullName: r.requested_by?.fullName,
      },
      targetUserId: r.target_user_id,
      itemCount: counts.get(r.id) ?? 0,
      note: r.note,
      rejectReason: r.reject_reason,
      decidedAt: r.decided_at,
      createdAt: r.created_at,
    }));

    return { data, total, page, pageSize };
  }

  async getDetail(id: number) {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: ['requested_by'],
    });
    if (!request) throw new NotFoundException('Không tìm thấy đề xuất');

    // Cả hai loại đề xuất trả CÙNG hình dạng diff (old_data/new_data/action)
    // để màn hình hàng chờ duyệt render một bộ code. Dòng chỉ tiêu chưa từng
    // có (old_target_value = null) là "thêm mới", đã có là "cập nhật" — giá
    // trị cũ lấy từ lúc đề xuất, dùng để hoàn tác khi duyệt nhầm.
    let items: any[];
    if (request.request_type === ApprovalRequestType.CUSTOMER_LIST) {
      items = await this.customerItemRepo.find({
        where: { request_id: id },
        order: { created_at: 'ASC' },
      });
    } else {
      const targetItems = await this.targetItemRepo.find({
        where: { request_id: id },
        order: { created_at: 'ASC' },
      });
      items = targetItems.map((item) => ({
        ...item,
        action: item.old_target_value != null ? 'update' : 'create',
        old_data:
          item.old_target_value != null
            ? { target_value: Number(item.old_target_value) }
            : null,
        new_data:
          item.new_target_value != null
            ? { target_value: Number(item.new_target_value) }
            : null,
        target_value: item.new_target_value,
      }));
    }

    // Tên người trong phòng bị tác động (nếu có)
    const targetUser = request.target_user_id
      ? await this.userRepo.findOne({
          where: { id: request.target_user_id },
          select: ['id', 'fullName', 'employeeCode'],
        })
      : null;

    return {
      request: {
        id: request.id,
        requestType: request.request_type,
        status: request.status,
        requestedBy: request.requested_by
          ? {
              id: request.requested_by.id,
              fullName: request.requested_by.fullName,
            }
          : null,
        targetUser,
        note: request.note,
        rejectReason: request.reject_reason,
        decidedAt: request.decided_at,
        createdAt: request.created_at,
      },
      items,
    };
  }

  /** Caller và sale bị tác động có chung phòng ban không? */
  private async sharesDepartmentWith(
    user: any,
    targetUserId: number,
  ): Promise<boolean> {
    const callerDeptIds = (user?.departments || [])
      .map((d: any) => d?.id)
      .filter(Boolean);
    if (!callerDeptIds.length) return false;
    const found = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin('u.departments', 'd')
      .where('u.id = :targetUserId', { targetUserId })
      .andWhere('d.id IN (:...callerDeptIds)', { callerDeptIds })
      .getOne();
    return !!found;
  }

  /**
   * Duyệt / từ chối (Mục 2, cv 6 + Mục 4, cv 4):
   * - customer_list: admin HOẶC trưởng phòng CÙNG PHÒNG với sale bị tác động.
   *   Duyệt → áp các mục vào dữ liệu thật; từ chối → chỉ ghi lý do.
   * - kpi_target: trưởng phòng đề xuất → QUẢN TRỊ VIÊN duyệt (thiết kế 5.2).
   *   Duyệt → ghi các mục vào kpi_targets; từ chối → chỉ ghi lý do.
   */
  async decide(id: number, dto: DecideApprovalDto, user: any) {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: ['requested_by'],
    });
    if (!request) throw new NotFoundException('Không tìm thấy đề xuất');
    if (request.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException('Đề xuất đã được xử lý');
    }
    if (dto.action === 'reject' && !dto.reject_reason) {
      throw new BadRequestException('Từ chối đề xuất phải kèm lý do');
    }

    const roles = (user?.roles || []).map((r: any) =>
      (typeof r === 'string' ? r : r?.name || '').toLowerCase(),
    );
    const isAdmin = roles.includes('admin');

    if (request.request_type === ApprovalRequestType.KPI_TARGET) {
      if (!isAdmin) {
        throw new ForbiddenException(
          'Chỉ quản trị viên mới được duyệt chỉ tiêu',
        );
      }
      if (dto.action === 'reject') {
        request.status = ApprovalStatus.REJECTED;
        request.decided_by = user.id;
        request.decided_at = new Date();
        request.reject_reason = dto.reject_reason ?? null;
        await this.requestRepo.save(request);
        return { decided: true, status: 'rejected' };
      }
      // Duyệt → ghi từng mục vào kpi_targets (customer_id null quy về 0 =
      // chỉ tiêu cả danh sách — cùng quy ước UNIQUE key với gán thẳng).
      // MỘT TRANSACTION: duyệt nhầm phải hoàn tác được (xem undo) nên không
      // được để lại trạng thái "đã duyệt một nửa".
      const targetItems = await this.targetItemRepo.find({
        where: { request_id: id },
      });
      await this.dataSource.transaction(async (em) => {
        for (const item of targetItems) {
          await em
            .createQueryBuilder()
            .insert()
            .into(KpiTarget)
            .values({
              criterion_key: item.criterion_key,
              period_month: item.period_month,
              sale_id: item.sale_id,
              customer_id: item.customer_id ?? 0,
              target_value: Number(item.new_target_value ?? 0),
              created_by: user.id,
            })
            .orUpdate({ overwrite: ['target_value', 'created_by'] })
            .execute();
        }
        request.status = ApprovalStatus.APPROVED;
        request.decided_by = user.id;
        request.decided_at = new Date();
        await em.save(request);
      });
      return { decided: true, status: 'approved', applied: targetItems.length };
    }

    if (!isAdmin) {
      const isDeptManager =
        roles.some((r) => r.startsWith('manager-')) &&
        request.target_user_id != null &&
        (await this.sharesDepartmentWith(user, request.target_user_id));
      if (!isDeptManager) {
        throw new ForbiddenException(
          'Chỉ trưởng phòng của sale này mới được duyệt đề xuất',
        );
      }
    }

    if (dto.action === 'reject') {
      request.status = ApprovalStatus.REJECTED;
      request.decided_by = user.id;
      request.decided_at = new Date();
      request.reject_reason = dto.reject_reason ?? null;
      await this.requestRepo.save(request);
      return { decided: true, status: 'rejected' };
    }

    // Duyệt → áp các mục vào dữ liệu thật
    const items = await this.customerItemRepo.find({
      where: { request_id: id },
    });
    let applied = 0;
    for (const item of items) {
      const customer = await this.customerRepo.findOne({
        where: {
          customer_code: item.customer_code,
          sap_code: item.sap_code ?? '',
        },
      });

      if (item.action === ApprovalCustomerAction.DELETE) {
        if (customer && customer.status !== CustomerStatus.DELETED) {
          customer.status = CustomerStatus.DELETED;
          await this.customerRepo.save(customer);
          applied++;
        }
        continue;
      }

      let target = customer;
      if (!target && item.action === ApprovalCustomerAction.CREATE) {
        const nd = item.new_data || {};
        target = await this.customerRepo.save(
          this.customerRepo.create({
            customer_code: item.customer_code,
            sap_code: item.sap_code ?? '',
            customer_name: nd.customer_name ?? item.customer_name ?? null,
            customer_role: nd.customer_role ?? null,
            debt_limit: nd.debt_limit ?? null,
            status: CustomerStatus.ACTIVE,
          }),
        );
      }
      if (!target) continue;

      const nd = item.new_data || {};
      if (item.action === ApprovalCustomerAction.CREATE) {
        if (item.department_slug && request.target_user_id) {
          const duplicated = await this.assignmentRepo.findOne({
            where: {
              customer_id: target.id,
              department_slug: item.department_slug,
            },
          });
          if (!duplicated) {
            await this.assignmentRepo.save(
              this.assignmentRepo.create({
                customer_id: target.id,
                sale_id: request.target_user_id,
                department_slug: item.department_slug,
                customer_tier: (item.customer_tier ?? 'NON') as CustomerTier,
              }),
            );
            applied++;
          }
        }
        continue;
      }

      // UPDATE — khoanh đúng phân công của sale bị tác động: cùng một khách có
      // thể đang nằm ở hai sale khác nhau (phòng khác), không được sửa nhầm dòng
      if (nd.customer_tier && item.department_slug) {
        const assignment = await this.assignmentRepo.findOne({
          where: {
            customer_id: target.id,
            department_slug: item.department_slug,
            ...(request.target_user_id
              ? { sale_id: request.target_user_id }
              : {}),
          },
        });
        if (assignment) {
          assignment.customer_tier = nd.customer_tier;
          await this.assignmentRepo.save(assignment);
        }
      }
      if (nd.customer_role) target.customer_role = nd.customer_role;
      if (nd.customer_name) target.customer_name = nd.customer_name;
      if (nd.debt_limit != null) target.debt_limit = nd.debt_limit;
      await this.customerRepo.save(target);
      applied++;
    }

    request.status = ApprovalStatus.APPROVED;
    request.decided_by = user.id;
    request.decided_at = new Date();
    await this.requestRepo.save(request);
    return { decided: true, status: 'approved', appliedItems: applied };
  }

  /**
   * Hoàn tác đề xuất giao chỉ tiêu ĐÃ DUYỆT — trả chỉ tiêu về giá trị cũ
   * (old_target_value đã lưu lúc đề xuất; dòng mà đề xuất tạo mới thì bị xoá
   * đi). Đây là cơ chế "cứu" khi admin duyệt nhầm, tương tự rollback của
   * import — không bắt người dùng xuống tầng database.
   *
   * Từ chối hoàn tác nếu giá trị HIỆN TẠI khác giá trị đề xuất đã ghi
   * (nghĩa là sau khi duyệt có người gán lại): trả về danh sách xung đột để
   * người dùng tự quyết, KHÔNG ghi đè dữ liệu mới hơn.
   */
  async undo(id: number, user: any) {
    const request = await this.requestRepo.findOne({
      where: { id },
      relations: ['requested_by'],
    });
    if (!request) throw new NotFoundException('Không tìm thấy đề xuất');
    if (request.request_type !== ApprovalRequestType.KPI_TARGET) {
      throw new BadRequestException('Chỉ hoàn tác được đề xuất giao chỉ tiêu');
    }
    if (!isAdmin(user)) {
      throw new ForbiddenException(
        'Chỉ quản trị viên mới được hoàn tác đề xuất chỉ tiêu',
      );
    }
    if (request.status !== ApprovalStatus.APPROVED) {
      throw new BadRequestException('Chỉ hoàn tác được đề xuất đã duyệt');
    }

    // Kiểm tra hết TRƯỚC khi ghi — hoàn tác phải nguyên tử: hoặc trả về
    // nguyên trạng thái trước khi duyệt, hoặc không đụng vào gì.
    const items = await this.targetItemRepo.find({ where: { request_id: id } });
    const conflicts: Array<{ saleId: number; reason: string }> = [];
    const plans: Array<{ item: ApprovalRequestTargetItem; row: KpiTarget }> =
      [];
    for (const item of items) {
      const row = await this.kpiTargetRepo.findOne({
        where: {
          criterion_key: item.criterion_key,
          period_month: item.period_month,
          sale_id: item.sale_id,
          customer_id: item.customer_id ?? 0,
        },
      });
      if (!row) {
        // Đề xuất TẠO MỚI (old rỗng) mà dòng sau đó đã bị xoá → không cần gì.
        // Đề xuất CẬP NHẬT mà dòng đã mất → không khôi phục được, phải báo.
        if (item.old_target_value != null) {
          conflicts.push({
            saleId: item.sale_id,
            reason: 'chỉ tiêu không còn trong hệ thống',
          });
        }
        continue;
      }
      if (
        item.new_target_value != null &&
        Number(row.target_value) !== Number(item.new_target_value)
      ) {
        conflicts.push({
          saleId: item.sale_id,
          reason: `giá trị hiện tại (${row.target_value}) khác giá trị đề xuất đã duyệt (${item.new_target_value}) — có thể đã gán lại sau đó`,
        });
        continue;
      }
      plans.push({ item, row });
    }
    if (conflicts.length) {
      throw new BadRequestException({
        message: 'Không hoàn tác được — chỉ tiêu đã thay đổi sau khi duyệt',
        conflicts,
      });
    }

    let restored = 0;
    await this.dataSource.transaction(async (em) => {
      for (const { item, row } of plans) {
        if (item.old_target_value == null) {
          await em.delete(KpiTarget, row.id);
        } else {
          row.target_value = Number(item.old_target_value);
          await em.save(row);
        }
        restored++;
      }
      request.status = ApprovalStatus.UNDONE;
      request.undone_by = user.id;
      request.undone_at = new Date();
      await em.save(request);
    });

    return { undone: true, restored, status: request.status };
  }
}

import {
  ForbiddenException,
  Injectable,
  NotImplementedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { Customer, CustomerStatus } from './customer.entity';
import { CustomerAssignment, CustomerTier } from './customer-assignment.entity';
import { CustomerZalo } from './customer-zalo.entity';
import { CustomerResponseDaily } from './customer-response-daily.entity';
import { CustomerActivityDaily } from './customer-activity-daily.entity';
import { CustomerRole } from './customer.entity';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { UpdateZaloLinkDto } from './dto/update-zalo-link.dto';
import {
  BulkUpdateCustomersDto,
  CreateCustomerDto,
  ZaloContactQueryDto,
} from './dto/create-customer.dto';
import { ApprovalRequest, ApprovalRequestType, ApprovalStatus } from './approval-request.entity';
import { ApprovalRequestCustomerItem, ApprovalCustomerAction } from './approval-request-customer-item.entity';

/** DB Zalo nằm cùng MySQL host — đọc thẳng bảng liên hệ để chọn tay cặp khớp. */
const ZALO_DB = 'zalo_automation';

/** 6 slug phòng ban cố định của file Excel (Phụ lục A.4). */
const DEPARTMENT_SLUGS = ['may-in', 'pc', 'linh-kien', 'laptop', 'ptkh1', 'ptkh2'];

/**
 * Phạm vi xem theo vai trò của module (xem scopeUserIds bên dưới).
 * Phân biệt undefined (không lọc — toàn công ty) với [] (không được thấy gì) —
 * theo đúng tiền lệ sale-response.service.ts:106-117.
 */
@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(CustomerAssignment)
    private readonly assignmentRepo: Repository<CustomerAssignment>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CustomerZalo)
    private readonly zaloRepo: Repository<CustomerZalo>,
    @InjectRepository(CustomerResponseDaily)
    private readonly responseRepo: Repository<CustomerResponseDaily>,
    @InjectRepository(CustomerActivityDaily)
    private readonly activityRepo: Repository<CustomerActivityDaily>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(ApprovalRequest)
    private readonly approvalRequestRepo: Repository<ApprovalRequest>,
    @InjectRepository(ApprovalRequestCustomerItem)
    private readonly approvalCustomerItemRepo: Repository<ApprovalRequestCustomerItem>,
  ) {}

  /**
   * Nhân viên (không phải admin/trưởng phòng) ghi thao tác → tạo ĐỀ XUẤT chờ
   * trưởng phòng duyệt thay vì áp dụng thẳng (thiết kế phần vai trò).
   */
  private async createCustomerProposal(
    user: any,
    targetSaleId: number,
    action: ApprovalCustomerAction,
    customer: Customer | null,
    draft: {
      customer_code: string;
      sap_code: string;
      department_slug: string | null;
      customer_tier: string | null;
      old_data: any;
      new_data: any;
    },
  ) {
    const request = await this.approvalRequestRepo.save(
      this.approvalRequestRepo.create({
        request_type: ApprovalRequestType.CUSTOMER_LIST,
        requested_by: { id: user.id } as any,
        target_user_id: targetSaleId,
        status: ApprovalStatus.PENDING,
      }),
    );
    await this.approvalCustomerItemRepo.save(
      this.approvalCustomerItemRepo.create({
        request_id: request.id,
        action,
        customer_code: draft.customer_code,
        sap_code: draft.sap_code,
        customer_name: customer?.customer_name ?? null,
        department_slug: draft.department_slug,
        customer_tier: (draft.customer_tier ?? null) as any,
        old_data: draft.old_data,
        new_data: draft.new_data,
      }),
    );
    return { proposal: true, requestId: request.id, status: 'pending_approval' };
  }

  private lowerRoles(user: any): string[] {
    return (user?.roles || []).map((r: any) =>
      (typeof r === 'string' ? r : r?.name || '').toLowerCase(),
    );
  }

  /**
   * Caller có được ghi trực tiếp vào danh sách của saleId không?
   * admin: bất kỳ; manager-<phòng>: sale thuộc phòng ban của caller.
   * (nhân viên -> false, route sẽ trả 501 chờ luồng duyệt Mục 2)
   */
  private async canManageSale(user: any, saleId: number): Promise<boolean> {
    const roles = this.lowerRoles(user);
    if (roles.includes('admin')) return true;
    if (!roles.some((r) => r.startsWith('manager-'))) return false;
    const callerDeptIds = (user.departments || [])
      .map((d: any) => d?.id)
      .filter(Boolean);
    if (callerDeptIds.length === 0) return false;
    const found = await this.userRepo
      .createQueryBuilder('u')
      .leftJoin('u.departments', 'd')
      .where('u.id = :saleId', { saleId })
      .andWhere('d.id IN (:...callerDeptIds)', { callerDeptIds })
      .getOne();
    return !!found;
  }

  /**
   * Phạm vi xem của MODULE KHÁCH HÀNG — cố ý KHÔNG dùng resolveScope của
   * sale-response: trang đó yêu cầu role 'analysis' vì là báo cáo dữ liệu Zalo,
   * trong khi danh sách khách hàng theo vai trò của chính module (đã được
   * PermissionGuard chặn ở tầng route):
   *   admin / PM / pm-khach-hang / view  -> toàn công ty (undefined)
   *   manager-<phòng>                    -> người trong các phòng ban của mình
   *   còn lại (user-khach-hang...)       -> chỉ của chính mình
   * Manager KHÔNG lọc phòng có server_ip như sale-response: dữ liệu phân bổ
   * khách hàng không phụ thuộc server Zalo.
   */
  private async scopeUserIds(user: any): Promise<number[] | undefined> {
    if (!user?.id) throw new ForbiddenException('Không xác định được người dùng');
    const roleNames: string[] = (user.roles || []).map((r: any) =>
      typeof r === 'string' ? r : (r?.name || ''),
    );
    const lower = roleNames.map((r) => r.toLowerCase());
    if (
      lower.includes('admin') ||
      lower.includes('pm') ||
      lower.includes('view') ||
      lower.some((r) => r.startsWith('pm-'))
    ) {
      return undefined;
    }
    if (lower.some((r) => r.startsWith('manager-'))) {
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
    return [user.id];
  }

  async findAll(query: CustomerQueryDto, user: any) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const userIds = await this.scopeUserIds(user);
    if (userIds !== undefined && userIds.length === 0) {
      return { data: [], total: 0, page, pageSize };
    }

    const qb = this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.customer', 'c')
      .andWhere('c.status != :deletedStatus', {
        deletedStatus: CustomerStatus.DELETED,
      });

    if (userIds !== undefined) {
      qb.andWhere('a.sale_id IN (:...userIds)', { userIds });
    }
    if (query.saleId) {
      qb.andWhere('a.sale_id = :saleId', { saleId: query.saleId });
    }
    if (query.department) {
      qb.andWhere('a.department_slug = :department', {
        department: query.department,
      });
    }
    if (query.tier) {
      qb.andWhere('a.customer_tier = :tier', { tier: query.tier });
    }
    if (query.role) {
      qb.andWhere('c.customer_role = :role', { role: query.role });
    }
    if (query.zaloStatus === 'linked') {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM customer_zalo cz WHERE cz.assignment_id = a.id AND cz.is_active = 1)',
      );
    }
    if (query.zaloStatus === 'unlinked') {
      qb.andWhere(
        'NOT EXISTS (SELECT 1 FROM customer_zalo cz WHERE cz.assignment_id = a.id AND cz.is_active = 1)',
      );
    }
    if (query.search) {
      qb.andWhere('(c.customer_code LIKE :search OR c.customer_name LIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    qb.orderBy('a.department_slug', 'ASC')
      .addOrderBy('c.customer_code', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [assignments, total] = await qb.getManyAndCount();

    // Gom thông tin sale + số liên kết Zalo theo lô, tránh N+1
    const saleIds = [...new Set(assignments.map((a) => a.sale_id))];
    const users = saleIds.length
      ? await this.userRepo.find({
          where: { id: In(saleIds) },
          select: ['id', 'fullName', 'employeeCode', 'zaloLinkStatus'],
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const assignmentIds = assignments.map((a) => a.id);
    const linkCounts = assignmentIds.length
      ? await this.zaloRepo
          .createQueryBuilder('cz')
          .select('cz.assignment_id', 'assignment_id')
          .addSelect('COUNT(*)', 'link_count')
          .where('cz.assignment_id IN (:...assignmentIds)', { assignmentIds })
          .andWhere('cz.is_active = 1')
          .groupBy('cz.assignment_id')
          .getRawMany()
      : [];
    const countMap = new Map(
      linkCounts.map((r) => [Number(r.assignment_id), Number(r.link_count)]),
    );

    const data = assignments.map((a) => {
      const u = userMap.get(a.sale_id);
      const linkCount = countMap.get(a.id) ?? 0;
      return {
        assignmentId: a.id,
        departmentSlug: a.department_slug,
        customerTier: a.customer_tier,
        saleId: a.sale_id,
        saleName: u?.fullName ?? null,
        saleZaloLinked: (u?.zaloLinkStatus ?? 0) === 1,
        zaloLinked: linkCount > 0,
        zaloAccountCount: linkCount,
        customer: {
          id: a.customer.id,
          customerCode: a.customer.customer_code,
          customerName: a.customer.customer_name,
          sapCode: a.customer.sap_code,
          customerRole: a.customer.customer_role,
          debtLimit: a.customer.debt_limit,
          status: a.customer.status,
        },
      };
    });

    return { data, total, page, pageSize };
  }

  async findOne(assignmentId: number, user: any) {
    const userIds = await this.scopeUserIds(user);
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ['customer'],
    });
    if (!assignment) {
      throw new ForbiddenException('Không tìm thấy khách hàng hoặc không thuộc phạm vi của bạn');
    }
    if (userIds !== undefined && !userIds.includes(assignment.sale_id)) {
      throw new ForbiddenException('Khách hàng không thuộc phạm vi của bạn');
    }

    const sale = await this.userRepo.findOne({
      where: { id: assignment.sale_id },
      select: ['id', 'fullName', 'employeeCode', 'zaloLinkStatus'],
    });
    const zaloAccounts = await this.zaloRepo.find({
      where: { assignment_id: assignmentId, is_active: true },
      order: { created_at: 'DESC' },
    });

    return {
      assignmentId: assignment.id,
      departmentSlug: assignment.department_slug,
      customerTier: assignment.customer_tier,
      // Map camelCase để khớp đúng hình dạng response của GET /customers
      customer: {
        id: assignment.customer.id,
        customerCode: assignment.customer.customer_code,
        customerName: assignment.customer.customer_name,
        sapCode: assignment.customer.sap_code,
        customerRole: assignment.customer.customer_role,
        debtLimit: assignment.customer.debt_limit,
        status: assignment.customer.status,
      },
      sale: sale
        ? {
            id: sale.id,
            fullName: sale.fullName,
            employeeCode: sale.employeeCode,
            zaloLinked: sale.zaloLinkStatus === 1,
          }
        : null,
      zaloAccounts: zaloAccounts.map((z) => ({
        id: z.id,
        zaloContactId: z.zalo_contact_id,
        zaloAccountId: z.zalo_account_id,
        matchedName: z.matched_name,
        matchedPosition: z.matched_position,
        matchMethod: z.match_method,
        isActive: z.is_active,
        lastVerifiedAt: z.last_verified_at,
      })),
    };
  }

  async getZaloAccounts(assignmentId: number, user: any) {
    const detail = await this.findOne(assignmentId, user);
    const rows = await this.zaloRepo.find({
      where: { assignment_id: assignmentId },
      order: { created_at: 'DESC' },
    });
    // Cùng hình dạng camelCase với zaloAccounts trong GET /customers/:id
    const zaloAccounts = rows.map((z) => ({
      id: z.id,
      zaloContactId: z.zalo_contact_id,
      zaloAccountId: z.zalo_account_id,
      matchedName: z.matched_name,
      matchedPosition: z.matched_position,
      matchMethod: z.match_method,
      isActive: z.is_active,
      lastVerifiedAt: z.last_verified_at,
    }));
    return { assignmentId: detail.assignmentId, zaloAccounts };
  }

  /** KH chưa tìm thấy tài khoản Zalo nào, để xử lý tập trung (Mục 3). */
  async getUnmatched(query: CustomerQueryDto, user: any) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const userIds = await this.scopeUserIds(user);
    if (userIds !== undefined && userIds.length === 0) {
      return { data: [], total: 0, page, pageSize };
    }

    const qb = this.assignmentRepo
      .createQueryBuilder('a')
      .innerJoinAndSelect('a.customer', 'c')
      .andWhere('c.status != :deletedStatus', {
        deletedStatus: CustomerStatus.DELETED,
      })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM customer_zalo cz WHERE cz.assignment_id = a.id AND cz.is_active = 1)',
      );

    if (userIds !== undefined) {
      qb.andWhere('a.sale_id IN (:...userIds)', { userIds });
    }
    if (query.department) {
      qb.andWhere('a.department_slug = :department', {
        department: query.department,
      });
    }
    if (query.tier) {
      qb.andWhere('a.customer_tier = :tier', { tier: query.tier });
    }
    if (query.search) {
      qb.andWhere('(c.customer_code LIKE :search OR c.customer_name LIKE :search)', {
        search: `%${query.search}%`,
      });
    }

    qb.orderBy('a.department_slug', 'ASC')
      .addOrderBy('c.customer_code', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [assignments, total] = await qb.getManyAndCount();

    const saleIds = [...new Set(assignments.map((a) => a.sale_id))];
    const users = saleIds.length
      ? await this.userRepo.find({
          where: { id: In(saleIds) },
          select: ['id', 'fullName', 'zaloLinkStatus'],
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = assignments.map((a) => {
      const u = userMap.get(a.sale_id);
      const offline = (u?.zaloLinkStatus ?? 0) !== 1;
      return {
        assignmentId: a.id,
        departmentSlug: a.department_slug,
        customerTier: a.customer_tier,
        saleId: a.sale_id,
        saleName: u?.fullName ?? null,
        reason: offline ? 'sale_chua_ket_noi_zalo' : 'chua_tim_thay',
        customer: {
          id: a.customer.id,
          customerCode: a.customer.customer_code,
          customerName: a.customer.customer_name,
        },
      };
    });

    return { data, total, page, pageSize };
  }

  /** Số liệu phản hồi + hoạt động theo ngày của một khách hàng (Mục 7-6). */
  async getResponseDaily(assignmentId: number, from: string, to: string, user: any) {
    await this.findOne(assignmentId, user); // kiểm tra tồn tại + phạm vi

    const [responseDaily, activityDaily] = await Promise.all([
      this.responseRepo
        .createQueryBuilder('r')
        .where('r.assignment_id = :assignmentId', { assignmentId })
        .andWhere('r.stat_date BETWEEN :from AND :to', { from, to })
        .orderBy('r.stat_date', 'ASC')
        .getMany(),
      this.activityRepo
        .createQueryBuilder('cad')
        .where('cad.assignment_id = :assignmentId', { assignmentId })
        .andWhere('cad.stat_date BETWEEN :from AND :to', { from, to })
        .orderBy('cad.stat_date', 'ASC')
        .getMany(),
    ]);

    return { assignmentId, from, to, responseDaily, activityDaily };
  }

  /** Chi tiết một cặp khớp Zalo (customer_zalo.id). */
  async getZaloLink(linkId: number, user: any) {
    const link = await this.zaloRepo.findOne({
      where: { id: linkId },
      relations: ['assignment', 'assignment.customer'],
    });
    if (!link) throw new ForbiddenException('Không tìm thấy cặp khớp Zalo');

    const userIds = await this.scopeUserIds(user);
    if (userIds !== undefined && !userIds.includes(link.assignment.sale_id)) {
      throw new ForbiddenException('Cặp khớp không thuộc phạm vi của bạn');
    }
    return link;
  }

  /**
   * Sửa tay cặp khớp Zalo ↔ khách hàng (đặt match_method = 'manual' để job
   * tự khớp không ghi đè). Thuộc Mục 3 — công việc con 2.
   */
  async updateZaloLink(linkId: number, dto: UpdateZaloLinkDto, user: any) {
    void linkId;
    void dto;
    void user;
    throw new NotImplementedException(
      'Sửa tay cặp khớp Zalo sẽ xây ở Mục 3 (công việc con 2)',
    );
  }

  /**
   * Thêm khách hàng bằng tay: tái sử dụng khách theo mã (nếu đã bị xoá thì
   * kích hoạt lại) + tạo dòng phân công cho sale.
   */
  async createCustomer(dto: CreateCustomerDto, user: any) {
    if (!DEPARTMENT_SLUGS.includes(dto.department_slug)) {
      throw new BadRequestException(
        `department_slug phải là một trong: ${DEPARTMENT_SLUGS.join(', ')}`,
      );
    }

    const roles = this.lowerRoles(user);
    const isManagerOrAdmin =
      roles.includes('admin') || roles.some((r) => r.startsWith('manager-'));
    if (!isManagerOrAdmin) {
      // Nhân viên chỉ được đề xuất thêm khách cho CHÍNH MÌNH
      if (dto.sale_id !== user.id) {
        throw new ForbiddenException('Chỉ được đề xuất thêm khách cho chính mình');
      }
      return this.createCustomerProposal(user, dto.sale_id, ApprovalCustomerAction.CREATE, null, {
        customer_code: dto.customer_code,
        sap_code: dto.sap_code ?? '',
        department_slug: dto.department_slug,
        customer_tier: dto.customer_tier,
        old_data: null,
        new_data: {
          customer_code: dto.customer_code,
          sap_code: dto.sap_code ?? '',
          customer_name: dto.customer_name ?? null,
          customer_role: dto.customer_role ?? null,
          debt_limit: dto.debt_limit ?? null,
          department_slug: dto.department_slug,
          customer_tier: dto.customer_tier,
        },
      });
    }
    if (!(await this.canManageSale(user, dto.sale_id))) {
      throw new ForbiddenException('Sale không thuộc phạm vi quản lý của bạn');
    }

    // Tìm hoặc tạo khách theo CẶP (mã, SAP) — cùng mã khác SAP là khách khác,
    // được tạo thêm dòng mới (ví dụ HQS_Q03_SR_PHUCHAI với C00375 và C00552)
    const existing = await this.customerRepo.findOne({
      where: { customer_code: dto.customer_code, sap_code: dto.sap_code ?? '' },
    });
    let customer: Customer;
    if (existing) {
      if (existing.status === CustomerStatus.DELETED) {
        existing.status = CustomerStatus.ACTIVE;
        await this.customerRepo.save(existing);
      }
      customer = existing;
    } else {
      customer = await this.customerRepo.save(
        this.customerRepo.create({
          customer_code: dto.customer_code,
          customer_name: dto.customer_name ?? null,
          sap_code: dto.sap_code ?? '',
          customer_role: (dto.customer_role ?? null) as CustomerRole | null,
          debt_limit: dto.debt_limit ?? null,
          status: CustomerStatus.ACTIVE,
        }),
      );
    }

    const duplicated = await this.assignmentRepo.findOne({
      where: {
        customer_id: customer.id,
        sale_id: dto.sale_id,
        department_slug: dto.department_slug,
      },
    });
    if (duplicated) {
      throw new ConflictException(
        'Khách này đã được phân công cho sale ở phòng ban này',
      );
    }

    // Tự tra tài khoản Zalo của sale nếu không truyền — zalo_accounts ở DB zalo_automation
    let zaloAccountId = dto.zalo_account_id ?? null;
    if (!zaloAccountId) {
      const rows: any[] = await this.dataSource.query(
        `SELECT id FROM \`${ZALO_DB}\`.zalo_accounts WHERE user_id = ? ORDER BY id LIMIT 1`,
        [dto.sale_id],
      );
      zaloAccountId = rows[0]?.id ?? null;
    }

    const assignment = await this.assignmentRepo.save(
      this.assignmentRepo.create({
        customer_id: customer.id,
        sale_id: dto.sale_id,
        zalo_account_id: zaloAccountId,
        department_slug: dto.department_slug,
        customer_tier: dto.customer_tier as CustomerTier,
      }),
    );

    return {
      assignmentId: assignment.id,
      departmentSlug: assignment.department_slug,
      customerTier: assignment.customer_tier,
      zaloAccountId: assignment.zalo_account_id,
      customer,
    };
  }

  /**
   * Xoá khách khỏi hệ thống — ĐẶT STATUS = 'deleted' (không xoá dòng, rollback
   * được), đúng cách import đang làm. LƯU Ý: khách là danh tính dùng chung,
   * xoá ẩn khách với MỌI sale — FE hiển thị cảnh báo khi xác nhận.
   */
  async removeCustomer(assignmentId: number, user: any) {
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ['customer'],
    });
    if (!assignment) {
      throw new ForbiddenException('Không tìm thấy khách hàng hoặc không thuộc phạm vi của bạn');
    }
    const roles = this.lowerRoles(user);
    const isManagerOrAdmin =
      roles.includes('admin') || roles.some((r) => r.startsWith('manager-'));
    if (!isManagerOrAdmin) {
      if (assignment.sale_id !== user.id) {
        throw new ForbiddenException('Chỉ được đề xuất xoá khách của chính mình');
      }
      return this.createCustomerProposal(
        user,
        assignment.sale_id,
        ApprovalCustomerAction.DELETE,
        assignment.customer,
        {
          customer_code: assignment.customer.customer_code,
          sap_code: assignment.customer.sap_code,
          department_slug: assignment.department_slug,
          customer_tier: assignment.customer_tier,
          old_data: { status: assignment.customer.status },
          new_data: { status: CustomerStatus.DELETED },
        },
      );
    }
    if (!(await this.canManageSale(user, assignment.sale_id))) {
      throw new ForbiddenException('Sale không thuộc phạm vi quản lý của bạn');
    }
    if (assignment.customer.status === CustomerStatus.DELETED) {
      throw new NotFoundException('Khách đã bị xoá trước đó');
    }

    assignment.customer.status = CustomerStatus.DELETED;
    await this.customerRepo.save(assignment.customer);
    return { deleted: true, customerId: assignment.customer.id };
  }

  /** Đổi Key/Non hoặc Chính/Phụ cho nhiều dòng phân công cùng lúc. */
  async bulkUpdate(dto: BulkUpdateCustomersDto, user: any) {
    if (!dto.customer_tier && !dto.customer_role) {
      throw new BadRequestException(
        'Phải truyền ít nhất customer_tier hoặc customer_role',
      );
    }
    const roles = this.lowerRoles(user);
    const isManagerOrAdmin =
      roles.includes('admin') || roles.some((r) => r.startsWith('manager-'));
    if (!isManagerOrAdmin) {
      throw new NotImplementedException(
        'Nhân viên đổi hàng loạt sẽ đi qua luồng đề xuất → trưởng phòng duyệt — Mục 2 (cv 5-6)',
      );
    }

    const assignments = dto.assignmentIds.length
      ? await this.assignmentRepo.find({
          where: { id: In(dto.assignmentIds) },
          relations: ['customer'],
        })
      : [];
    const skipped: Array<{ assignmentId: number; reason: string }> = [];
    let updated = 0;

    for (const assignmentId of dto.assignmentIds) {
      const assignment = assignments.find((a) => a.id === assignmentId);
      if (!assignment) {
        skipped.push({ assignmentId, reason: 'không tồn tại' });
        continue;
      }
      if (!(await this.canManageSale(user, assignment.sale_id))) {
        skipped.push({ assignmentId, reason: 'ngoài phạm vi quản lý' });
        continue;
      }
      if (assignment.customer.status === CustomerStatus.DELETED) {
        // Bulk-update không được lặng lẽ sửa dữ liệu của khách đã bị xoá
        skipped.push({ assignmentId, reason: 'khách đã bị xoá' });
        continue;
      }
      if (dto.customer_tier) {
        assignment.customer_tier = dto.customer_tier as CustomerTier;
        await this.assignmentRepo.save(assignment);
      }
      if (dto.customer_role) {
        assignment.customer.customer_role = dto.customer_role as CustomerRole;
        await this.customerRepo.save(assignment.customer);
      }
      updated++;
    }

    return { updated, skipped };
  }

  /**
   * Tra cứu liên hệ Zalo để chọn tay khi sửa cặp khớp (Mục 3, màn hình 5-5).
   * Đọc thẳng zalo_automation.zalo_contacts (cùng MySQL host — đã kiểm chứng
   * quyền đọc). Phạm vi: admin/PM/view tra mọi tài khoản; manager tra tài khoản
   * của người trong phòng; nhân viên chỉ tài khoản của chính mình.
   */
  async zaloContacts(query: ZaloContactQueryDto, user: any) {
    const limit = Math.min(query.limit ?? 50, 200);
    const userIds = await this.scopeUserIds(user);

    let allowedAccountIds: number[] | null = null; // null = không giới hạn
    if (userIds !== undefined) {
      if (userIds.length === 0) return { data: [] };
      const rows: any[] = await this.dataSource.query(
        `SELECT id FROM \`${ZALO_DB}\`.zalo_accounts WHERE user_id IN (?) ORDER BY id`,
        [userIds],
      );
      allowedAccountIds = rows.map((r) => Number(r.id));
      // Kiểm tra accountId TRƯỚC khi rút gọn — user không có tài khoản nào
      // vẫn phải bị 403 khi đòi tra tài khoản người khác, không được trả rỗng lặng lẽ
      if (query.accountId && !allowedAccountIds.includes(query.accountId)) {
        throw new ForbiddenException('Tài khoản Zalo không thuộc phạm vi của bạn');
      }
      if (allowedAccountIds.length === 0) return { data: [] };
    }

    const params: any[] = [];
    let sql = `SELECT zc.zalo_account_id AS accountId, zc.zalo_contact_id AS zaloContactId,
                      zc.display_name AS displayName, zc.is_blocked AS isBlocked
               FROM \`${ZALO_DB}\`.zalo_contacts zc WHERE zc.is_active = 1`;
    if (allowedAccountIds !== null) {
      sql += ' AND zc.zalo_account_id IN (?)';
      params.push(allowedAccountIds);
    } else if (query.accountId) {
      sql += ' AND zc.zalo_account_id = ?';
      params.push(query.accountId);
    }
    if (query.search) {
      sql += ' AND zc.display_name LIKE ?';
      params.push(`%${query.search}%`);
    }
    sql += ' ORDER BY zc.display_name ASC LIMIT ?';
    params.push(limit);

    const data: any[] = await this.dataSource.query(sql, params);
    return { data };
  }

  /**
   * Sửa tier / CHÍNH-PHỤ / tên / hạn mức (Mục 2, cv 5):
   * - admin + trưởng phòng (cùng phòng với sale): áp dụng thẳng.
   * - nhân viên: chỉ được đề xuất sửa DANH SÁCH CỦA CHÍNH MÌNH → tạo đề xuất
   *   chờ trưởng phòng duyệt (cv 6).
   */
  async update(assignmentId: number, dto: UpdateCustomerDto, user: any) {
    if (
      !dto.customer_tier &&
      !dto.customer_role &&
      dto.customer_name === undefined &&
      dto.debt_limit === undefined
    ) {
      throw new BadRequestException('Cần ít nhất một trường để sửa');
    }

    const userIds = await this.scopeUserIds(user);
    const assignment = await this.assignmentRepo.findOne({
      where: { id: assignmentId },
      relations: ['customer'],
    });
    if (!assignment) {
      throw new ForbiddenException('Không tìm thấy khách hàng hoặc không thuộc phạm vi của bạn');
    }
    if (userIds !== undefined && !userIds.includes(assignment.sale_id)) {
      throw new ForbiddenException('Khách hàng không thuộc phạm vi của bạn');
    }

    const oldData = {
      customer_tier: assignment.customer_tier,
      customer_role: assignment.customer.customer_role,
      customer_name: assignment.customer.customer_name,
      debt_limit: assignment.customer.debt_limit,
    };
    const newData: any = {};
    if (dto.customer_tier) newData.customer_tier = dto.customer_tier;
    if (dto.customer_role) newData.customer_role = dto.customer_role;
    if (dto.customer_name !== undefined) newData.customer_name = dto.customer_name;
    if (dto.debt_limit !== undefined) newData.debt_limit = dto.debt_limit;

    const roles = this.lowerRoles(user);
    const isManagerOrAdmin =
      roles.includes('admin') || roles.some((r) => r.startsWith('manager-'));

    if (!isManagerOrAdmin) {
      if (assignment.sale_id !== user.id) {
        throw new ForbiddenException('Chỉ được đề xuất sửa danh sách của chính mình');
      }
      return this.createCustomerProposal(
        user,
        assignment.sale_id,
        ApprovalCustomerAction.UPDATE,
        assignment.customer,
        {
          customer_code: assignment.customer.customer_code,
          sap_code: assignment.customer.sap_code,
          department_slug: assignment.department_slug,
          customer_tier: (newData.customer_tier ?? null) as string,
          old_data: oldData,
          new_data: newData,
        },
      );
    }

    if (!(await this.canManageSale(user, assignment.sale_id))) {
      throw new ForbiddenException('Sale không thuộc phạm vi quản lý của bạn');
    }

    if (newData.customer_tier) {
      assignment.customer_tier = newData.customer_tier as CustomerTier;
      await this.assignmentRepo.save(assignment);
    }
    const customer = assignment.customer;
    if (newData.customer_role) customer.customer_role = newData.customer_role as CustomerRole;
    if (newData.customer_name !== undefined) customer.customer_name = newData.customer_name;
    if (newData.debt_limit !== undefined) customer.debt_limit = newData.debt_limit;
    await this.customerRepo.save(customer);

    return {
      applied: true,
      assignmentId: assignment.id,
      customerTier: assignment.customer_tier,
      customer: {
        id: customer.id,
        customerCode: customer.customer_code,
        customerName: customer.customer_name,
        customerRole: customer.customer_role,
        debtLimit: customer.debt_limit,
      },
    };
  }
}

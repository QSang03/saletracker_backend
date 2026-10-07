import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import * as fs from 'fs';
import { User } from '../users/user.entity';
import { Customer, CustomerStatus } from './customer.entity';
import { CustomerAssignment, CustomerTier } from './customer-assignment.entity';
import { CustomerImportSession } from './customer-import-session.entity';
import { CustomerImportBackup } from './customer-import-backup.entity';
import {
  CustomerImportChange,
  ImportChangeAction,
  ImportChangeDecision,
} from './customer-import-change.entity';
import {
  ImportSessionQueryDto,
  ChangeDecisionDto,
} from './dto/import-session-query.dto';
import {
  parseImportWorkbook,
  ParsedCustomerRow,
} from './customer-import-parser';

/**
 * Quy tắc kiến trúc: KHÔNG tra DB Zalo khi import — zalo_account_id để trống,
 * job Python (customer_zalo_matcher_service) tự gắn trong vòng quét ≤ 5 phút.
 */
/** 6 slug phòng ban cố định của file Excel (Phụ lục A.4). */
const DEPARTMENT_SLUGS = [
  'may-in',
  'pc',
  'linh-kien',
  'laptop',
  'ptkh1',
  'ptkh2',
];

const isAdmin = (user: any) =>
  Array.isArray(user?.roles) &&
  user.roles.some(
    (r: any) => (typeof r === 'string' ? r : r?.name) === 'admin',
  );

/**
 * Nhóm API nạp danh sách khách hàng từ Excel: upload -> so khớp (diff) ->
 * người dùng chọn Giữ/Bỏ từng thay đổi -> apply (có rollback).
 *
 * Đầy đủ: đọc Excel (parser riêng), sinh diff, preview, đặt quyết định,
 * apply 1 transaction (backup từng thay đổi), rollback từ backup, sinh file mẫu.
 * Import chỉ dành cho admin (@Permission 'import') — apply/rollback/decide/cancel
 * kiểm tra thêm phiên sở hữu qua assertSessionOwner.
 */
@Injectable()
export class CustomerAssignmentsService {
  constructor(
    @InjectRepository(CustomerImportSession)
    private readonly sessionRepo: Repository<CustomerImportSession>,
    @InjectRepository(CustomerImportChange)
    private readonly changeRepo: Repository<CustomerImportChange>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(CustomerAssignment)
    private readonly assignmentRepo: Repository<CustomerAssignment>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(CustomerImportBackup)
    private readonly backupRepo: Repository<CustomerImportBackup>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async getSessions(query: ImportSessionQueryDto, user: any) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const qb = this.sessionRepo
      .createQueryBuilder('s')
      .leftJoin('s.uploaded_by', 'u')
      .addSelect(['u.id', 'u.fullName']);

    // Người không phải admin chỉ thấy session mình upload
    if (!isAdmin(user)) {
      qb.andWhere('s.uploaded_by = :userId', { userId: user.id });
    }
    if (query.status) {
      qb.andWhere('s.status = :status', { status: query.status });
    }
    if (query.saleId) {
      // session không gắn sale trực tiếp — lọc qua mã khách trong changes là
      // việc của Mục 2; hiện chỉ hỗ trợ lọc status
      void query.saleId;
    }

    qb.orderBy('s.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [sessions, total] = await qb.getManyAndCount();
    return { data: sessions, total, page, pageSize };
  }

  async getPreview(
    sessionId: number,
    query: { action?: string; page?: number; pageSize?: number },
  ) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Không tìm thấy session import');

    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 50;

    const qb = this.changeRepo
      .createQueryBuilder('ch')
      .where('ch.session_id = :sessionId', { sessionId })
      .orderBy('ch.row_num', 'ASC');

    if (query.action && this.isValidAction(query.action)) {
      qb.andWhere('ch.action = :action', { action: query.action });
    }

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [changes, total] = await qb.getManyAndCount();

    return {
      session,
      summary: {
        create: session.create_count,
        update: session.update_count,
        delete: session.delete_count,
      },
      data: changes,
      total,
      page,
      pageSize,
    };
  }

  async setChangeDecision(
    sessionId: number,
    changeId: number,
    dto: ChangeDecisionDto,
    user: any,
  ) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: { uploaded_by: true },
    });
    if (!session) throw new NotFoundException('Không tìm thấy session import');
    this.assertSessionOwner(session, user);
    if (session.status !== 'pending_review') {
      throw new BadRequestException(
        'Session đã xử lý xong, không đổi được quyết định',
      );
    }

    const change = await this.changeRepo.findOne({
      // dùng cột scalar — where qua relation trên entity có cột kép gây lỗi lạ
      where: { id: changeId, session_id: sessionId },
    });
    if (!change) {
      throw new NotFoundException('Không tìm thấy thay đổi trong session này');
    }

    change.decision = dto.decision as ImportChangeDecision;
    change.decided_by = user.id;
    change.decided_at = new Date();
    await this.changeRepo.save(change);
    return change;
  }

  /**
   * Chỉ người tạo phiên (hoặc admin) được apply / rollback / đổi quyết định /
   * huỷ — list session đã lọc theo người dùng, nhưng thao tác theo id thì
   * không được phép lách qua phiên của người khác.
   */
  private assertSessionOwner(session: CustomerImportSession, user: any) {
    if (isAdmin(user)) return;
    const ownerId = (session.uploaded_by as any)?.id ?? null;
    if (ownerId !== user?.id) {
      throw new ForbiddenException(
        'Chỉ người tạo phiên import (hoặc admin) mới được thao tác trên phiên này',
      );
    }
  }

  private isValidAction(value: string): value is ImportChangeAction {
    return ['create', 'update', 'delete', 'unchanged'].includes(value);
  }

  /**
   * Nạp file Excel: đọc → chuẩn hoá → so khớp với dữ liệu hiện có → lưu session
   * + danh sách thay đổi ĐỀ XUẤT (chưa ghi gì vào dữ liệu thật).
   * Phiên bản này chỉ tạo session; apply/rollback là các API riêng (Mục 2, cv 4).
   */
  async createImport(file: any, user: any) {
    if (!file) throw new BadRequestException('Thiếu file Excel');
    const originalName = String(file.originalname || 'import.xlsx');
    if (!originalName.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Chỉ nhận file .xlsx');
    }

    const buffer: Buffer = file.buffer ?? fs.readFileSync(file.path);
    const parsed = await parseImportWorkbook(buffer);

    // 1) Mã nhân viên trong file -> users.id (không tự tạo user)
    const empCodes = [
      ...new Set(
        parsed.customers.flatMap((c) =>
          c.assignments.map((a) => a.employee_code),
        ),
      ),
    ];
    const users = empCodes.length
      ? await this.userRepo.find({
          where: { employeeCode: In(empCodes) },
          select: ['id', 'employeeCode'],
        })
      : [];
    const userIdByEmp = new Map(
      users.map((u) => [u.employeeCode as string, u.id]),
    );

    // 2) (đã bỏ) tra tài khoản Zalo của sale — chuyển sang job Python

    // 3) Trạng thái hiện tại trong DB
    const dbCustomers = await this.customerRepo.find();
    const dbCustomerByKey = new Map(
      dbCustomers.map((c) => [`${c.customer_code}|${c.sap_code}`, c]),
    );
    const dbAssignments = await this.assignmentRepo.find();
    const assignmentsByCustomer = new Map<number, CustomerAssignment[]>();
    for (const a of dbAssignments) {
      const list = assignmentsByCustomer.get(a.customer_id) || [];
      list.push(a);
      assignmentsByCustomer.set(a.customer_id, list);
    }

    // 4) Sinh danh sách thay đổi đề xuất
    interface ChangeDraft {
      row_num: number;
      customer_code: string;
      sap_code: string;
      department_slug: string | null;
      action: ImportChangeAction;
      old_data: any;
      new_data: any;
      error: string | null;
    }
    const drafts: ChangeDraft[] = [];
    const rowErrors: Array<{ row_num: number; errors: string[] }> = [];
    const summary = {
      rowsParsed: parsed.rowCount,
      customersParsed: parsed.customers.length,
      duplicatePairs: parsed.duplicatePairs,
      create: 0,
      update: 0,
      delete: 0,
      unchanged: 0,
      errorRows: 0,
    };

    const changeErrorFor = (
      p: ParsedCustomerRow,
      saleId?: number,
    ): string | null => {
      const parts = [...p.errors];
      if (!saleId)
        parts.push(
          'Không tìm thấy nhân viên trong hệ thống theo mã trong file',
        );
      if (!parts.length) return null;
      return parts.join('; ').slice(0, 255);
    };

    for (const p of parsed.customers) {
      const key = `${p.customer_code}|${p.sap_code}`;
      const dbCustomer = dbCustomerByKey.get(key);
      const parsedDeptSlugs = new Set(
        p.assignments.map((a) => a.department_slug),
      );
      if (p.errors.length) {
        summary.errorRows++;
        rowErrors.push({ row_num: p.row_num, errors: p.errors });
      }

      // 4a. Thông tin khách đổi (hoặc khách đã xoá được kích hoạt lại).
      // File không có cột tên khách — không so sánh customer_name.
      if (dbCustomer) {
        const oldFields: any = {};
        const newFields: any = {};
        if (dbCustomer.status === CustomerStatus.DELETED) {
          oldFields.status = dbCustomer.status;
          newFields.status = CustomerStatus.ACTIVE;
        }
        if (p.customer_role && p.customer_role !== dbCustomer.customer_role) {
          oldFields.customer_role = dbCustomer.customer_role;
          newFields.customer_role = p.customer_role;
        }
        if (
          p.debt_limit != null &&
          Number(dbCustomer.debt_limit) !== p.debt_limit
        ) {
          oldFields.debt_limit = dbCustomer.debt_limit;
          newFields.debt_limit = p.debt_limit;
        }
        if (Object.keys(newFields).length) {
          drafts.push({
            row_num: p.row_num,
            customer_code: p.customer_code,
            sap_code: p.sap_code,
            department_slug: null,
            action: ImportChangeAction.UPDATE,
            old_data: oldFields,
            new_data: newFields,
            error: p.errors.join('; ').slice(0, 255) || null,
          });
        }
      }

      // 4b. Phân công: tạo mới / cập nhật (đổi sale, đổi tier)
      for (const a of p.assignments) {
        const saleId = userIdByEmp.get(a.employee_code) ?? null;
        const existing = dbCustomer
          ? (assignmentsByCustomer.get(dbCustomer.id) || []).find(
              (x) => x.department_slug === a.department_slug,
            )
          : undefined;
        const newRow = {
          sale_id: saleId,
          customer_tier: a.tier,
          zalo_account_id: null, // job Python tự gắn ≤ 5 phút sau khi apply
        };
        const error = changeErrorFor(p, saleId ?? undefined);

        if (!existing) {
          drafts.push({
            row_num: p.row_num,
            customer_code: p.customer_code,
            sap_code: p.sap_code,
            department_slug: a.department_slug,
            action: ImportChangeAction.CREATE,
            old_data: null,
            new_data: {
              ...newRow,
              customer: dbCustomer
                ? { id: dbCustomer.id, status: CustomerStatus.ACTIVE }
                : {
                    customer_code: p.customer_code,
                    sap_code: p.sap_code,
                    customer_role: p.customer_role,
                    debt_limit: p.debt_limit,
                  },
            },
            error,
          });
        } else if (
          existing.sale_id !== newRow.sale_id ||
          existing.customer_tier !== newRow.customer_tier
        ) {
          drafts.push({
            row_num: p.row_num,
            customer_code: p.customer_code,
            sap_code: p.sap_code,
            department_slug: a.department_slug,
            action: ImportChangeAction.UPDATE,
            old_data: {
              sale_id: existing.sale_id,
              customer_tier: existing.customer_tier,
              zalo_account_id: existing.zalo_account_id,
            },
            new_data: newRow,
            error,
          });
        } else {
          summary.unchanged++;
        }
      }

      // 4c. Phòng có phân công trong DB nhưng trống trong file → xoá dòng phân công
      if (dbCustomer) {
        for (const existing of assignmentsByCustomer.get(dbCustomer.id) || []) {
          if (
            parsedDeptSlugs.has(existing.department_slug) ||
            !DEPARTMENT_SLUGS.includes(existing.department_slug)
          ) {
            continue;
          }
          drafts.push({
            row_num: 0,
            customer_code: p.customer_code,
            sap_code: p.sap_code,
            department_slug: existing.department_slug,
            action: ImportChangeAction.DELETE,
            old_data: {
              sale_id: existing.sale_id,
              customer_tier: existing.customer_tier,
              zalo_account_id: existing.zalo_account_id,
            },
            new_data: null,
            error: null,
          });
        }
      }
    }

    // 4d. Khách đang hoạt động trong DB nhưng vắng mặt trong file → xoá toàn bộ
    const parsedKeys = new Set(
      parsed.customers.map((p) => `${p.customer_code}|${p.sap_code}`),
    );
    for (const dbCustomer of dbCustomers) {
      if (dbCustomer.status === CustomerStatus.DELETED) continue;
      if (parsedKeys.has(`${dbCustomer.customer_code}|${dbCustomer.sap_code}`))
        continue;
      for (const a of assignmentsByCustomer.get(dbCustomer.id) || []) {
        drafts.push({
          row_num: 0,
          customer_code: dbCustomer.customer_code,
          sap_code: dbCustomer.sap_code,
          department_slug: a.department_slug,
          action: ImportChangeAction.DELETE,
          old_data: {
            sale_id: a.sale_id,
            customer_tier: a.customer_tier,
            zalo_account_id: a.zalo_account_id,
          },
          new_data: null,
          error: 'Khách không có trong file',
        });
      }
    }

    for (const d of drafts) {
      if (d.action === ImportChangeAction.CREATE) summary.create++;
      else if (d.action === ImportChangeAction.UPDATE) summary.update++;
      else if (d.action === ImportChangeAction.DELETE) summary.delete++;
    }

    // 5) Lưu session + changes (một transaction; change chèn theo lô 500)
    const session = await this.dataSource.transaction(async (em) => {
      const saved = await em.save(
        em.create(CustomerImportSession, {
          file_name: originalName,
          uploaded_by: { id: user.id } as any,
          status: 'pending_review' as any,
          create_count: summary.create,
          update_count: summary.update,
          delete_count: summary.delete,
        }),
      );
      for (let i = 0; i < drafts.length; i += 500) {
        const chunk = drafts.slice(i, i + 500).map((d) =>
          em.create(CustomerImportChange, {
            ...d,
            session_id: saved.id,
            decision: ImportChangeDecision.PENDING,
          }),
        );
        await em.save(chunk);
      }
      return saved;
    });

    return {
      sessionId: session.id,
      status: session.status,
      summary,
      criteria: parsed.criteria,
      errors: rowErrors.slice(0, 50),
    };
  }

  /**
   * Ghi các thay đổi đã chọn vào dữ liệu thật (Mục 2, cv 4).
   * - decision 'pending' = theo đề xuất hệ thống (áp dụng); 'skip' = bỏ qua.
   * - Change có `error` (dòng dữ liệu bẩn) bị bỏ qua cho đến khi sửa file nạp lại.
   * - CREATE/UPDATE/DELETE đều ghi backup trước khi đụng dữ liệu → rollback được.
   * - DELETE: xoá cứng dòng phân công (backup giữ nguyên trạng thái để khôi phục
   *   cả id); nếu khách không còn phân công nào → đặt customers.status='deleted'.
   */
  async applySession(sessionId: number, user: any) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: { uploaded_by: true },
    });
    if (!session) throw new NotFoundException('Không tìm thấy session import');
    this.assertSessionOwner(session, user);
    if (session.status !== 'pending_review') {
      throw new BadRequestException(
        'Session đã xử lý xong, không apply lại được',
      );
    }

    const changes = await this.changeRepo.find({
      where: [
        { session_id: sessionId, decision: ImportChangeDecision.PENDING },
        { session_id: sessionId, decision: ImportChangeDecision.APPLY },
      ],
      order: { id: 'ASC' },
    });

    const conflicts: Array<{ changeId: number; reason: string }> = [];
    let applied = 0;
    let skippedErrors = 0;

    await this.dataSource.transaction(async (em) => {
      // Đưa khách + phân công hiện có vào bộ nhớ đệm, cập nhật dần trong lượt apply
      const customers = new Map(
        (await em.find(Customer)).map((c) => [c.id, c]),
      );
      const customerByKey = new Map(
        [...customers.values()].map((c) => [
          `${c.customer_code}|${c.sap_code}`,
          c,
        ]),
      );
      const assignmentsByCustomer = new Map<number, CustomerAssignment[]>();
      for (const a of await em.find(CustomerAssignment)) {
        const list = assignmentsByCustomer.get(a.customer_id) || [];
        list.push(a);
        assignmentsByCustomer.set(a.customer_id, list);
      }

      for (const change of changes) {
        if (change.error) {
          skippedErrors++;
          continue;
        }

        try {
          if (change.action === ImportChangeAction.CREATE) {
            const nd = change.new_data || {};
            // Tìm/tạo khách — có thể đã tồn tại nhờ change trước trong cùng lượt
            let customer = customerByKey.get(
              `${change.customer_code}|${change.sap_code}`,
            );
            let customerCreated = false;
            if (!customer) {
              customer = await em.save(
                em.create(Customer, {
                  customer_code: change.customer_code,
                  sap_code: change.sap_code,
                  customer_role: nd.customer?.customer_role ?? null,
                  debt_limit: nd.customer?.debt_limit ?? null,
                  status: CustomerStatus.ACTIVE,
                }),
              );
              customers.set(customer.id, customer);
              customerByKey.set(
                `${customer.customer_code}|${customer.sap_code}`,
                customer,
              );
              customerCreated = true;
            } else if (customer.status === CustomerStatus.DELETED) {
              customer.status = CustomerStatus.ACTIVE;
              await em.save(customer);
            }

            const duplicated = (
              assignmentsByCustomer.get(customer.id) || []
            ).some((x) => x.department_slug === change.department_slug);
            if (duplicated || !nd.sale_id) {
              conflicts.push({
                changeId: change.id,
                reason: duplicated
                  ? 'phân công đã tồn tại'
                  : 'thiếu nhân viên hợp lệ trong file',
              });
              continue;
            }

            const assignment = await em.save(
              em.create(CustomerAssignment, {
                customer_id: customer.id,
                sale_id: nd.sale_id,
                zalo_account_id: nd.zalo_account_id ?? null,
                // create/update change luôn có department_slug (customer-level
                // change đã tách riêng với department_slug = null)
                department_slug: change.department_slug as string,
                customer_tier: nd.customer_tier,
              }),
            );
            const list = assignmentsByCustomer.get(customer.id) || [];
            list.push(assignment);
            assignmentsByCustomer.set(customer.id, list);
            await em.save(
              em.create(CustomerImportBackup, {
                session_id: sessionId,
                assignment_id: assignment.id,
                original_data: {
                  action: 'CREATE',
                  customer_created: customerCreated,
                  customer_id: customer.id,
                },
                action_type: 'CREATE',
                user_id: user?.id ?? null,
              }),
            );
            applied++;
          } else if (change.action === ImportChangeAction.UPDATE) {
            if (change.department_slug === null) {
              // Cập nhật thông tin khách (kích hoạt lại / đổi Chính-Phụ / hạn mức)
              const customer = customers.get(
                this.customerIdFromChange(change, customerByKey),
              );
              if (!customer) {
                conflicts.push({
                  changeId: change.id,
                  reason: 'không tìm thấy khách',
                });
                continue;
              }
              await em.save(
                em.create(CustomerImportBackup, {
                  session_id: sessionId,
                  assignment_id: 0,
                  original_data: {
                    action: 'UPDATE_CUSTOMER',
                    customer: {
                      id: customer.id,
                      status: customer.status,
                      customer_role: customer.customer_role,
                      debt_limit: customer.debt_limit,
                    },
                  },
                  action_type: 'UPDATE',
                  user_id: user?.id ?? null,
                }),
              );
              const nd = change.new_data || {};
              if (nd.status) customer.status = nd.status;
              if (nd.customer_role) customer.customer_role = nd.customer_role;
              if (nd.debt_limit != null) customer.debt_limit = nd.debt_limit;
              await em.save(customer);
              applied++;
            } else {
              const assignment = (
                assignmentsByCustomer.get(
                  this.customerIdFromChange(change, customerByKey),
                ) || []
              ).find((x) => x.department_slug === change.department_slug);
              if (!assignment) {
                conflicts.push({
                  changeId: change.id,
                  reason: 'không tìm thấy phân công',
                });
                continue;
              }
              await em.save(
                em.create(CustomerImportBackup, {
                  session_id: sessionId,
                  assignment_id: assignment.id,
                  original_data: {
                    action: 'UPDATE_ASSIGNMENT',
                    assignment: {
                      id: assignment.id,
                      sale_id: assignment.sale_id,
                      customer_tier: assignment.customer_tier,
                      zalo_account_id: assignment.zalo_account_id,
                    },
                  },
                  action_type: 'UPDATE',
                  user_id: user?.id ?? null,
                }),
              );
              const nd = change.new_data || {};
              assignment.sale_id = nd.sale_id ?? assignment.sale_id;
              assignment.customer_tier = (nd.customer_tier ??
                assignment.customer_tier) as CustomerTier;
              assignment.zalo_account_id =
                nd.zalo_account_id ?? assignment.zalo_account_id;
              await em.save(assignment);
              applied++;
            }
          } else if (change.action === ImportChangeAction.DELETE) {
            const od = change.old_data || {};
            const customerId = this.customerIdFromChange(change, customerByKey);
            const assignment = (
              assignmentsByCustomer.get(customerId) || []
            ).find((x) => x.department_slug === change.department_slug);
            if (!assignment) {
              conflicts.push({
                changeId: change.id,
                reason: 'không tìm thấy phân công',
              });
              continue;
            }
            const customer = customers.get(customerId);
            await em.save(
              em.create(CustomerImportBackup, {
                session_id: sessionId,
                assignment_id: assignment.id,
                original_data: {
                  action: 'DELETE_ASSIGNMENT',
                  assignment: {
                    id: assignment.id,
                    customer_id: assignment.customer_id,
                    sale_id: assignment.sale_id,
                    department_slug: assignment.department_slug,
                    customer_tier: assignment.customer_tier,
                    zalo_account_id: assignment.zalo_account_id,
                  },
                  customer_status_before: customer?.status ?? null,
                },
                action_type: 'DELETE',
                user_id: user?.id ?? null,
              }),
            );
            try {
              await em.delete(CustomerAssignment, assignment.id);
              assignmentsByCustomer.set(
                customerId,
                (assignmentsByCustomer.get(customerId) || []).filter(
                  (x) => x.id !== assignment.id,
                ),
              );
            } catch {
              // FK chặn (đang có dữ liệu daily tham chiếu) → giữ nguyên dòng,
              // khách hàng vẫn ẩn qua status nếu toàn bộ phân công bị xoá
              conflicts.push({
                changeId: change.id,
                reason:
                  'phân công đang có dữ liệu KPI tham chiếu, không xoá được',
              });
              continue;
            }
            const remaining = (
              assignmentsByCustomer.get(customerId) || []
            ).filter(
              (x) =>
                x.department_slug &&
                DEPARTMENT_SLUGS.includes(x.department_slug),
            );
            if (
              customer &&
              remaining.length === 0 &&
              customer.status !== CustomerStatus.DELETED
            ) {
              customer.status = CustomerStatus.DELETED;
              await em.save(customer);
            }
            applied++;
          }
        } catch (e) {
          conflicts.push({
            changeId: change.id,
            reason: (e as Error).message?.slice(0, 200),
          });
        }
      }
    });

    session.status = 'applied' as any;
    session.applied_at = new Date();
    session.applied_by = user?.id ?? null;
    await this.sessionRepo.save(session);

    return {
      sessionId,
      applied,
      skippedErrors,
      conflicts,
      status: session.status,
    };
  }

  /** Khách của một change: tra theo key (mã|SAP) trong bộ đệm của lượt apply.
   *  Không thấy → 0; các nhánh sử dụng đều có guard "không tìm thấy" phía sau. */
  private customerIdFromChange(
    change: CustomerImportChange,
    customerByKey: Map<string, Customer>,
  ): number {
    return (
      customerByKey.get(`${change.customer_code}|${change.sap_code}`)?.id ?? 0
    );
  }

  /**
   * Hoàn tác session đã apply — đi ngược qua backup theo thứ tự ngược lại:
   * CREATE → xoá phân công (khách tự tạo bị xoá mềm), UPDATE → trả trạng thái cũ,
   * DELETE → dựng lại phân công (giữ nguyên id để dữ liệu KPI nối lại được).
   */
  async rollbackSession(sessionId: number, user: any) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: { uploaded_by: true },
    });
    if (!session) throw new NotFoundException('Không tìm thấy session import');
    this.assertSessionOwner(session, user);
    if (session.status !== 'applied') {
      throw new BadRequestException('Chỉ hoàn tác được session đã apply');
    }

    const backups = await this.backupRepo.find({
      where: { session_id: sessionId },
      order: { id: 'DESC' },
    });

    const skipped: Array<{ assignmentId: number; reason: string }> = [];
    let restored = 0;

    await this.dataSource.transaction(async (em) => {
      for (const backup of backups) {
        const od = backup.original_data || {};
        try {
          if (backup.action_type === 'CREATE') {
            // Xoá phân công đã tạo; khách tự tạo trong lượt apply → xoá mềm
            const assignment = await em.findOne(CustomerAssignment, {
              where: { id: backup.assignment_id },
            });
            if (!assignment) {
              skipped.push({
                assignmentId: backup.assignment_id,
                reason: 'phân công không còn',
              });
              continue;
            }
            await em.delete(CustomerAssignment, assignment.id);
            if (od.customer_created && od.customer_id) {
              const customer = await em.findOne(Customer, {
                where: { id: od.customer_id },
              });
              if (customer && customer.status !== CustomerStatus.DELETED) {
                customer.status = CustomerStatus.DELETED;
                await em.save(customer);
              }
            }
            restored++;
          } else if (backup.action_type === 'UPDATE') {
            if (od.customer) {
              const customer = await em.findOne(Customer, {
                where: { id: od.customer.id },
              });
              if (!customer) {
                skipped.push({ assignmentId: 0, reason: 'khách không còn' });
                continue;
              }
              customer.status = od.customer.status;
              customer.customer_role = od.customer.customer_role;
              customer.debt_limit = od.customer.debt_limit;
              await em.save(customer);
              restored++;
            } else if (od.assignment) {
              const assignment = await em.findOne(CustomerAssignment, {
                where: { id: od.assignment.id },
              });
              if (!assignment) {
                skipped.push({
                  assignmentId: od.assignment.id,
                  reason: 'phân công không còn',
                });
                continue;
              }
              assignment.sale_id = od.assignment.sale_id;
              assignment.customer_tier = od.assignment.customer_tier;
              assignment.zalo_account_id = od.assignment.zalo_account_id;
              await em.save(assignment);
              restored++;
            }
          } else if (backup.action_type === 'DELETE') {
            const odA = od.assignment || {};
            const existed = await em.findOne(CustomerAssignment, {
              where: { id: backup.assignment_id },
            });
            if (existed) {
              skipped.push({
                assignmentId: backup.assignment_id,
                reason: 'phân công vẫn còn, không cần dựng lại',
              });
              continue;
            }
            await em.save(
              em.create(CustomerAssignment, {
                id: backup.assignment_id,
                customer_id: odA.customer_id,
                sale_id: odA.sale_id,
                department_slug: odA.department_slug,
                customer_tier: odA.customer_tier,
                zalo_account_id: odA.zalo_account_id ?? null,
              }),
            );
            if (
              od.customer_status_before === CustomerStatus.ACTIVE &&
              odA.customer_id
            ) {
              const customer = await em.findOne(Customer, {
                where: { id: odA.customer_id },
              });
              if (customer && customer.status === CustomerStatus.DELETED) {
                customer.status = CustomerStatus.ACTIVE;
                await em.save(customer);
              }
            }
            restored++;
          }
        } catch (e) {
          skipped.push({
            assignmentId: backup.assignment_id,
            reason: (e as Error).message?.slice(0, 200),
          });
        }
      }
      // Backup đã hoàn thành sứ mệnh sau rollback — dọn để không phình dữ liệu
      await em.delete(CustomerImportBackup, { session_id: sessionId } as any);
    });

    session.status = 'rolled_back' as any;
    session.rolled_back_at = new Date();
    session.rolled_back_by = user?.id ?? null;
    await this.sessionRepo.save(session);

    return { sessionId, restored, skipped, status: session.status };
  }
  /** Sinh file Excel mẫu đúng cấu trúc parser đọc được (2 sheet + 2 dòng ví dụ). */
  async getTemplate(): Promise<{ buffer: Buffer; fileName: string }> {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();

    const tc = wb.addWorksheet('TIÊU CHÍ');
    for (const line of [
      'Tiêu  Chí',
      '1/ Doanh số theo Key',
      '2/ Doanh số theo NON',
      '3/ Support Khách / Thăm hỏi',
      '4/ Liên lạc / phản hồi',
      '5/ Gợi ý thực hiện',
    ]) {
      tc.addRow([line]);
    }

    const ws = wb.addWorksheet('File Chi Tiết');
    const headers = [
      'STT',
      'MÃ ĐỐI TÁC SAP',
      'MÃ KH',
      'S1-MÁY IN, MỰC IN',
      'S1-PC, LCD',
      'S1-PTTT',
      'S1-LAPTOP',
      'S1-PTKH1',
      'S1-PTKH2',
      'LOẠI MÃ',
      'LAPTOP',
      'LINH KIỆN',
      'MÁY IN',
      'PC - SERVER',
      'PTKH1',
      'PTKH2',
      'hạn mức',
      'T04',
      'T05',
      'T06',
      'T07',
      'T08',
      'T09',
      'ĐIẾM',
      'tổng ds',
    ];
    ws.addRow(headers);
    // 2 dòng ví dụ — người nhập xoá đi rồi điền theo
    ws.addRow([
      1,
      'C29962',
      'MBA_HNO_TH_THAKRALONE',
      '',
      '',
      '',
      'NKDS36-ĐỖ MINH HÙNG',
      '',
      '',
      'CHÍNH',
      'Key',
      '',
      '',
      '',
      '',
      '',
      50000000,
    ]);
    ws.addRow([
      2,
      'C00375',
      'HQS_Q03_SR_PHUCHAI',
      '',
      'NKDS20-NGUYỄN THỊ THANH HẰNG',
      '',
      '',
      '',
      '',
      'CHÍNH',
      '',
      'NON',
      '',
      '',
      '',
      '',
      0,
    ]);
    ws.columns.forEach((c) => (c.width = 22));

    const buf = await wb.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(buf as ArrayBuffer),
      fileName: 'mau-nap-khach-hang.xlsx',
    };
  }

  /** Huỷ session: chờ duyệt (xoá changes) hoặc đã hoàn tác (xoá changes + backup). */
  async cancelSession(sessionId: number, user: any) {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
      relations: { uploaded_by: true },
    });
    if (!session) throw new NotFoundException('Không tìm thấy session import');
    this.assertSessionOwner(session, user);
    if (
      session.status !== 'pending_review' &&
      session.status !== 'rolled_back'
    ) {
      throw new BadRequestException(
        'Chỉ huỷ được session đang chờ duyệt hoặc đã hoàn tác (session đã apply cần rollback trước)',
      );
    }
    session.status = 'cancelled' as any;
    await this.dataSource.transaction(async (em) => {
      await em.save(session);
      await em.delete(CustomerImportChange, { session_id: sessionId } as any);
      await em.delete(CustomerImportBackup, { session_id: sessionId } as any);
    });
    return { cancelled: true };
  }
}

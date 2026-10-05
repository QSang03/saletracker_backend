import {
  BadRequestException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerImportSession } from './customer-import-session.entity';
import { CustomerImportChange, ImportChangeAction, ImportChangeDecision } from './customer-import-change.entity';
import { ImportSessionQueryDto, ChangeDecisionDto } from './dto/import-session-query.dto';

const isAdmin = (user: any) =>
  Array.isArray(user?.roles) &&
  user.roles.some((r: any) => (typeof r === 'string' ? r : r?.name) === 'admin');

/**
 * Nhóm API nạp danh sách khách hàng từ Excel: upload -> so khớp (diff) ->
 * người dùng chọn Giữ/Bỏ từng thay đổi -> apply (có rollback).
 *
 * ĐÃ LÀM HÔM NAY: đọc lịch sử session, xem preview thay đổi, đặt quyết định.
 * Chưa làm (Mục 2 — công việc con 1, 3, 4, 2): đọc Excel, sinh diff, apply
 * transaction, rollback, sinh file mẫu.
 */
@Injectable()
export class CustomerAssignmentsService {
  constructor(
    @InjectRepository(CustomerImportSession)
    private readonly sessionRepo: Repository<CustomerImportSession>,
    @InjectRepository(CustomerImportChange)
    private readonly changeRepo: Repository<CustomerImportChange>,
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

  async getPreview(sessionId: number, query: { action?: string; page?: number; pageSize?: number }) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
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

  async setChangeDecision(sessionId: number, changeId: number, dto: ChangeDecisionDto, user: any) {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Không tìm thấy session import');
    if (session.status !== 'pending_review') {
      throw new BadRequestException('Session đã xử lý xong, không đổi được quyết định');
    }

    const change = await this.changeRepo.findOne({
      where: { id: changeId, session: { id: sessionId } },
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

  private isValidAction(value: string): value is ImportChangeAction {
    return ['create', 'update', 'delete', 'unchanged'].includes(value);
  }

  async createImport(file: any, user: any) {
    void file;
    void user;
    throw new NotImplementedException(
      'Đọc file Excel + so khớp diff sẽ xây ở Mục 2 (công việc con 1, 3)',
    );
  }

  async applySession(sessionId: number, user: any) {
    void sessionId;
    void user;
    throw new NotImplementedException(
      'Ghi các thay đổi đã chọn (transaction + backup) sẽ xây ở Mục 2 (công việc con 4)',
    );
  }

  async rollbackSession(sessionId: number, user: any) {
    void sessionId;
    void user;
    throw new NotImplementedException(
      'Hoàn tác từ backup sẽ xây ở Mục 2 (công việc con 4)',
    );
  }

  async getTemplate() {
    throw new NotImplementedException(
      'Sinh file Excel mẫu sẽ xây ở Mục 2 (công việc con 2)',
    );
  }
}

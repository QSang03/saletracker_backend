import {
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import {
  ApprovalRequest,
  ApprovalRequestType,
} from './approval-request.entity';
import { ApprovalRequestCustomerItem } from './approval-request-customer-item.entity';
import { ApprovalRequestTargetItem } from './approval-request-target-item.entity';
import { ApprovalRequestQueryDto, DecideApprovalDto } from './dto/approval-request.dto';

const isAdmin = (user: any) =>
  Array.isArray(user?.roles) &&
  user.roles.some((r: any) => (typeof r === 'string' ? r : r?.name) === 'admin');

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
  ) {}

  async list(query: ApprovalRequestQueryDto, user: any) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const qb = this.requestRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.requested_by', 'u');

    if (!isAdmin(user)) {
      // Người thường chỉ thấy đề xuất mình gửi hoặc mình là đối tượng tác động
      qb.andWhere('(r.requested_by = :userId OR r.target_user_id = :userId)', {
        userId: user.id,
      });
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

    const items =
      request.request_type === ApprovalRequestType.CUSTOMER_LIST
        ? await this.customerItemRepo.find({
            where: { request: { id } },
            order: { created_at: 'ASC' },
          })
        : await this.targetItemRepo.find({
            where: { request: { id } },
            order: { created_at: 'ASC' },
          });

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

  async decide(id: number, dto: DecideApprovalDto, user: any) {
    void id;
    void dto;
    void user;
    throw new NotImplementedException(
      'Duyệt / từ chối (ghi thay đổi vào dữ liệu + nhật ký) sẽ xây ở Mục 2 (cv 6) và Mục 4 (cv 4)',
    );
  }
}

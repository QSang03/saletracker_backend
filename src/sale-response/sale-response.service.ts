import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SaleResponseInterval, ResponseIntervalStatus } from './sale-response-interval.entity';
import { SaleResponseDaily } from './sale-response-daily.entity';
import { SaleWorkActivityDaily } from './sale-work-activity-daily.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';
import { OrderService } from '../orders/order.service';

export interface ResponseTimeFilters {
  dateFrom?: string;
  dateTo?: string;
  userIds?: number[];
  departmentIds?: number[];
  status?: string;
}

/**
 * Phạm vi dữ liệu được xem. userIds = undefined nghĩa là không lọc (xem hết).
 */
export interface DataScope {
  userIds?: number[];
}

/**
 * Chỉ đọc bảng tổng hợp. Mọi phép tính p50/p90 đã nằm sẵn trong sale_response_daily
 * (cron đêm ở core-python-backend), nên API này chỉ lọc và trả về.
 */
@Injectable()
export class SaleResponseService {
  constructor(
    @InjectRepository(SaleResponseDaily)
    private readonly dailyRepo: Repository<SaleResponseDaily>,
    @InjectRepository(SaleWorkActivityDaily)
    private readonly workRepo: Repository<SaleWorkActivityDaily>,
    @InjectRepository(SaleResponseInterval)
    private readonly intervalRepo: Repository<SaleResponseInterval>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly orderService: OrderService,
  ) {}

  /**
   * Quy tắc xem dữ liệu của trang này, theo thoả thuận nghiệp vụ:
   *   admin                        -> xem tất cả
   *   view                         -> theo phòng ban được phân quyền (dùng lại
   *                                  luật sẵn có của orders)
   *   manager + analysis           -> xem những sale trong phòng ban mình quản lý,
   *                                  chỉ tính phòng ban CÓ server_ip (phòng ban phụ
   *                                  không cài server thì không tính)
   *   user + analysis              -> chỉ xem của chính mình
   *   còn lại                      -> không được xem
   *
   * Cố ý KHÔNG sửa getUserIdsByRole ở orders: hàm đó đang được orders và
   * order-details dùng, sửa ở đó sẽ đổi tầm nhìn dữ liệu của những trang khác.
   */
  async resolveScope(user: any): Promise<DataScope> {
    if (!user?.id) throw new ForbiddenException('Không xác định được người dùng');

    const roleNames: string[] = (user.roles || []).map((r: any) =>
      typeof r === 'string' ? r.toLowerCase() : (r?.name || '').toLowerCase(),
    );
    const has = (role: string) => roleNames.includes(role);

    if (has('admin')) return {};

    if (has('view')) {
      const allowed = await this.orderService.getUserIdsByRole(user);
      return { userIds: allowed ?? [user.id] };
    }

    if (!has('analysis')) {
      throw new ForbiddenException(
        'Bạn không có quyền xem báo cáo thời gian phản hồi',
      );
    }

    if (!has('manager')) {
      // user + analysis: chỉ dữ liệu của chính mình
      return { userIds: [user.id] };
    }

    // manager + analysis: phòng ban mình thuộc về, chỉ lấy phòng ban có server_ip
    const departments: any[] = user.departments || [];
    const departmentIds = departments
      .filter((dept) => dept?.server_ip && String(dept.server_ip).trim() !== '')
      .map((dept) => dept.id);
    if (departmentIds.length === 0) return { userIds: [] };

    const users = await this.userRepo
      .createQueryBuilder('user')
      .leftJoin('user.departments', 'dept')
      .where('dept.id IN (:...departmentIds)', { departmentIds })
      .andWhere('user.deletedAt IS NULL')
      .getMany();
    return { userIds: users.map((u) => u.id) };
  }

  /**
   * Áp phạm vi user lên query.
   *
   * Phải phân biệt rõ undefined (không lọc - admin) với [] (được lọc nhưng không
   * thuộc sale nào). Nếu dùng `query.userIds?.length` thì [] sẽ bị coi là
   * "không lọc" và người không thuộc phòng nào sẽ nhìn thấy TOÀN BỘ dữ liệu.
   */
  private applyUserScope(
    qb: any,
    alias: string,
    userIds: number[] | undefined,
  ) {
    if (userIds === undefined) return;
    if (userIds.length === 0) {
      qb.andWhere('1 = 0');
      return;
    }
    qb.andWhere(`${alias}.user_id IN (:...userIds)`, { userIds });
  }

  /**
   * Loại các khoảng chờ mà chính sale sở hữu khoảng đó đã blacklist khách.
   *
   * order_blacklist khoá theo cặp (user_id, zalo_contact_id) nên phải so đúng
   * cặp. Không lọc toàn cục theo zalo_contact_id: cùng một khách vẫn có thể là
   * khách thật của sale khác.
   */
  private blacklistExclusion(alias: string): string {
    return `NOT EXISTS (
      SELECT 1 FROM order_blacklist bl
      WHERE bl.user_id = ${alias}.user_id
        AND bl.zalo_contact_id = ${alias}.zalo_contact_id
    )`;
  }

  private normalizeDate(value: string | undefined, fallback: Date): string {
    if (!value) return fallback.toISOString().slice(0, 10);
    // Chỉ nhận YYYY-MM-DD để tránh lệch ngày do timezone của client
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : new Date(value).toISOString().slice(0, 10);
  }

  private buildFilter(query: ResponseTimeFilters, alias: string) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);

    const dateFrom = this.normalizeDate(query.dateFrom, from);
    const dateTo = this.normalizeDate(query.dateTo, to);

    const qb = this.dailyRepo
      .createQueryBuilder(alias)
      .where(`${alias}.stat_date BETWEEN :dateFrom AND :dateTo`, {
        dateFrom,
        dateTo,
      });

    this.applyUserScope(qb, alias, query.userIds);
    if (query.departmentIds?.length) {
      qb.andWhere(`${alias}.department_id IN (:...departmentIds)`, {
        departmentIds: query.departmentIds,
      });
    }
    return qb;
  }

  /** Tổng hợp theo sale, sắp xếp theo p50. */
  async bySale(query: ResponseTimeFilters) {
    const rows = await this.buildFilter(query, 'd')
      .leftJoin('d.user', 'user')
      // Nối thẳng vào departments theo department_id đã chốt trong bảng ngày.
      // Không nối qua user.departments (quan hệ nhiều-nhiều): một sale thuộc 2
      // phòng ban sẽ nhân đôi dòng và làm SUM ở dưới bị sai.
      .leftJoin(Department, 'dept', 'dept.id = d.department_id')
      .select([
        'd.user_id AS "userId"',
        'user.full_name AS "fullName"',
        'user.employee_code AS "employeeCode"',
        'd.department_id AS "departmentId"',
        'dept.name AS "departmentName"',
        'SUM(d.total_intervals) AS "totalIntervals"',
        'SUM(d.responded_count) AS "respondedCount"',
        'SUM(d.no_reply_count) AS "noReplyCount"',
        'SUM(d.pending_count) AS "pendingCount"',
        'AVG(d.avg_seconds) AS "avgSeconds"',
        'MIN(d.min_seconds) AS "minSeconds"',
        'MAX(d.max_seconds) AS "maxSeconds"',
      ])
      .addSelect('SUM(d.over_cap_count)', 'overCapCount')
      // p50/p90 gộp nhiều ngày không có nghĩa cộng/quân bình được, nên lấy
      // theo ngày có tổng lớn nhất thay vì bị bình quân sai.
      .addSelect(
        `(SELECT d2.p50_seconds FROM sale_response_daily d2
           WHERE d2.user_id = d.user_id
             AND d2.stat_date BETWEEN :dateFrom AND :dateTo
           ORDER BY d2.total_intervals DESC LIMIT 1)`,
        'p50Seconds',
      )
      .addSelect(
        `(SELECT d3.p90_seconds FROM sale_response_daily d3
           WHERE d3.user_id = d.user_id
             AND d3.stat_date BETWEEN :dateFrom AND :dateTo
           ORDER BY d3.total_intervals DESC LIMIT 1)`,
        'p90Seconds',
      )
      // MySQL đang bật only_full_group_by: mọi cột không bọc hàm tổng hợp đều
      // phải có trong GROUP BY.
      .groupBy('d.user_id')
      .addGroupBy('d.department_id')
      .addGroupBy('user.full_name')
      .addGroupBy('user.employee_code')
      .addGroupBy('dept.name')
      .orderBy('`respondedCount`', 'DESC')
      .addOrderBy('`p50Seconds`', 'ASC')
      .setParameters({
        dateFrom: this.normalizeDate(
          query.dateFrom,
          new Date(Date.now() - 30 * 86400000),
        ),
        dateTo: this.normalizeDate(query.dateTo, new Date()),
      })
      .getRawMany();

    return rows.map((row) => ({
      ...row,
      ...this.mergeSlaCounts(row.userId, query),
    }));
  }

  /** Cộng dồn sla_breach_counts của từng ngày thành một object cho cả khoảng. */
  private async mergeSlaCounts(userId: number, query: ResponseTimeFilters) {
    const dateFrom = this.normalizeDate(
      query.dateFrom,
      new Date(Date.now() - 30 * 86400000),
    );
    const dateTo = this.normalizeDate(query.dateTo, new Date());

    const rows = await this.dailyRepo
      .createQueryBuilder('d')
      .select('d.sla_breach_counts', 'sla')
      .where('d.user_id = :userId', { userId })
      .andWhere('d.stat_date BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      })
      .andWhere('d.sla_breach_counts IS NOT NULL')
      .getRawMany();

    const merged: Record<string, number> = {};
    for (const row of rows) {
      const value =
        typeof row.sla === 'string' ? JSON.parse(row.sla) : row.sla;
      if (!value) continue;
      for (const [key, count] of Object.entries(value as Record<string, number>)) {
        merged[key] = (merged[key] ?? 0) + Number(count);
      }
    }
    return { slaBreachCounts: merged };
  }

  /** Chuỗi thời gian theo ngày, để vẽ biểu đồ. */
  async byDay(query: ResponseTimeFilters) {
    return this.buildFilter(query, 'd')
      .leftJoin('d.user', 'user')
      .select([
        'd.stat_date AS "statDate"',
        'd.user_id AS "userId"',
        'user.full_name AS "fullName"',
        'SUM(d.total_intervals) AS "totalIntervals"',
        'SUM(d.responded_count) AS "respondedCount"',
        'SUM(d.no_reply_count) AS "noReplyCount"',
        'AVG(d.avg_seconds) AS "avgSeconds"',
        'MAX(d.p50_seconds) AS "p50Seconds"',
        'MAX(d.p90_seconds) AS "p90Seconds"',
      ])
      .groupBy('d.stat_date')
      .addGroupBy('d.user_id')
      .addGroupBy('user.full_name')
      .orderBy('`statDate`', 'ASC')
      .addOrderBy('user.full_name', 'ASC')
      .getRawMany();
  }

  /** Hoạt động ngoài giờ làm việc — câu hỏi riêng, không phải phản hồi khách. */
  async workActivity(query: ResponseTimeFilters) {
    const dateFrom = this.normalizeDate(
      query.dateFrom,
      new Date(Date.now() - 30 * 86400000),
    );
    const dateTo = this.normalizeDate(query.dateTo, new Date());

    const qb = this.workRepo
      .createQueryBuilder('w')
      .leftJoin('w.user', 'user')
      // Xem chú thích ở bySale: join theo cột department_id của bảng ngày, không
      // join qua user.departments để tránh nhân dòng.
      .leftJoin(Department, 'dept', 'dept.id = w.department_id')
      .where('w.stat_date BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      });

    this.applyUserScope(qb, 'w', query.userIds);
    if (query.departmentIds?.length) {
      qb.andWhere('w.department_id IN (:...departmentIds)', {
        departmentIds: query.departmentIds,
      });
    }

    return qb
      .select([
        'w.user_id AS "userId"',
        'user.full_name AS "fullName"',
        'w.department_id AS "departmentId"',
        'dept.name AS "departmentName"',
        'SUM(w.in_hours_msg_count) AS "inHoursMsgCount"',
        'SUM(w.out_of_hours_msg_count) AS "outOfHoursMsgCount"',
        'MAX(w.has_out_of_hours) AS "hasOutOfHours"',
      ])
      .addSelect(
        'SUM(w.out_of_hours_span_minutes)',
        'outOfHoursSpanMinutes',
      )
      .groupBy('w.user_id')
      .addGroupBy('w.department_id')
      .addGroupBy('user.full_name')
      .addGroupBy('dept.name')
      .orderBy('`outOfHoursMsgCount`', 'DESC')
      .getRawMany();
  }

  /** Chi tiết từng khoảng chờ, để drill-down từ biểu đồ. */
  async intervals(
    query: ResponseTimeFilters & {
      userId?: number;
      page?: number;
      pageSize?: number;
    },
  ) {
    const dateFrom = this.normalizeDate(
      query.dateFrom,
      new Date(Date.now() - 30 * 86400000),
    );
    const dateTo = this.normalizeDate(query.dateTo, new Date());
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 200);

    const qb = this.intervalRepo
      .createQueryBuilder('i')
      // leftJoinAndSelect chứ không phải leftJoin: FE hiển thị tên sale ở cột
      // "Nhân viên tiếp nhận" (item.user.full_name) và lọc theo tên đó, mà
      // leftJoin chỉ thêm JOIN để lọc chứ không nạp dữ liệu relation.
      // Lưu ý: select() nhận tên property (fullName), không phải tên cột.
      .leftJoinAndSelect('i.user', 'user')
      .select(['i', 'user.id', 'user.fullName', 'user.employeeCode'])
      .where('DATE(i.started_at) BETWEEN :dateFrom AND :dateTo', {
        dateFrom,
        dateTo,
      });

    if (query.userId) {
      qb.andWhere('i.user_id = :userId', { userId: query.userId });
    }
    this.applyUserScope(qb, 'i', query.userIds);
    qb.andWhere(this.blacklistExclusion('i'));
    if (query.status) {
      qb.andWhere('i.status = :status', { status: query.status });
    }

    const [items, total] = await qb
      .orderBy('i.started_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    // Payload của endpoint này là entity nên mọi key đều snake_case, và FE đọc
    // item.user.full_name. Vì vậy trả object user dạng snake_case thay vì để
    // entity User lộ ra fullName/employeeCode (và kéo theo cả chục cột khác).
    return {
      page,
      pageSize,
      total,
      items: items.map((item) => ({
        ...item,
        user: item.user
          ? {
              id: item.user.id,
              full_name: item.user.fullName ?? null,
              employee_code: item.user.employeeCode ?? null,
            }
          : null,
      })),
    };
  }

  /** Tổng quan để dựng KPI ở đầu trang. */
  async overview(query: ResponseTimeFilters) {
    const dateFrom = this.normalizeDate(
      query.dateFrom,
      new Date(Date.now() - 30 * 86400000),
    );
    const dateTo = this.normalizeDate(query.dateTo, new Date());

    const counts = await this.buildFilter(query, 'd')
      .select('SUM(d.total_intervals)', 'totalIntervals')
      .addSelect('SUM(d.responded_count)', 'respondedCount')
      .addSelect('SUM(d.no_reply_count)', 'noReplyCount')
      .addSelect('SUM(d.pending_count)', 'pendingCount')
      .addSelect('SUM(d.over_cap_count)', 'overCapCount')
      .addSelect('COUNT(DISTINCT d.user_id)', 'saleCount')
      .setParameters({ dateFrom, dateTo })
      .getRawOne();

    // Trung bình / nhanh nhất / chậm nhất phải tính trên danh sách khoảng chờ
    // thật. Lấy AVG của các trung bình theo ngày cho ra một con số khác: ngày
    // chỉ có 1 khoảng sẽ được sức nặng ngang ngày có 200 khoảng.
    const scope = [
      'i.started_at >= :dateFrom',
      'i.started_at < DATE_ADD(:dateTo, INTERVAL 1 DAY)',
    ];
    if (query.userIds !== undefined) {
      // Mảng rỗng = không thuộc sale nào -> không được thấy thời lượng nào
      scope.push(
        query.userIds.length === 0
          ? '1 = 0'
          : 'i.user_id IN (:...userIds)',
      );
    }

    // Các cột đếm phía trên đọc từ sale_response_daily, nên blacklist đã được
    // loại ở bước rollup. Phần thời lượng dưới đây đọc thẳng intervals nên phải
    // loại blacklist tại đây để khớp với số đếm.
    const durations = await this.intervalRepo
      .createQueryBuilder('i')
      .select('AVG(i.duration_seconds)', 'avgSeconds')
      .addSelect('MIN(i.duration_seconds)', 'minSeconds')
      .addSelect('MAX(i.duration_seconds)', 'maxSeconds')
      .where('i.status = :status', { status: ResponseIntervalStatus.RESPONDED })
      .andWhere('i.duration_seconds IS NOT NULL')
      .andWhere(`(${scope.join(' AND ')})`)
      .andWhere(this.blacklistExclusion('i'))
      .setParameters({ dateFrom, dateTo, userIds: query.userIds ?? [] })
      .getRawOne();

    const totalIntervals = Number(counts?.totalIntervals ?? 0);
    const noReplyCount = Number(counts?.noReplyCount ?? 0);
    const closed = totalIntervals - Number(counts?.pendingCount ?? 0);

    return {
      totalIntervals,
      respondedCount: Number(counts?.respondedCount ?? 0),
      noReplyCount,
      pendingCount: Number(counts?.pendingCount ?? 0),
      overCapCount: Number(counts?.overCapCount ?? 0),
      saleCount: Number(counts?.saleCount ?? 0),
      avgSeconds: durations?.avgSeconds ?? null,
      minSeconds: durations?.minSeconds ?? null,
      maxSeconds: durations?.maxSeconds ?? null,
      // Tỷ lệ không phản hồi chỉ có nghĩa trên các khoảng đã đóng; khoảng còn
      // mở thì chưa biết là sale chậm hay khách đã bỏ.
      noReplyRate: closed > 0 ? (noReplyCount / closed) * 100 : null,
    };
  }
  /** Cấu hình mốc SLA đang dùng, để FE hiển thị cho khớp với số liệu. */
  statuses() {
    return Object.values(ResponseIntervalStatus);
  }
}
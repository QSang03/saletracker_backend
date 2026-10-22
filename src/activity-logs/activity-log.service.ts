import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { ActivityLog, ActivityAction } from './activity-log.entity';
import { User } from '../users/user.entity';
import { CreateActivityLogDto } from './dto/create-activity-log.dto';
import { QueryActivityLogDto } from './dto/query-activity-log.dto';

/**
 * Ngữ cảnh người ghi log — luôn lấy từ JWT + request, không tin vào body.
 */
export interface ActivityLogContext {
  userId: number | null;
  username?: string | null;
  fullName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Các field nhạy cảm không được lưu vào old_values / new_values.
 * Khi phát hiện, giá trị sẽ bị thay bằng '***'.
 */
const SENSITIVE_FIELDS = [
  'password',
  'newpassword',
  'oldpassword',
  'currentpassword',
  'confirmpassword',
  'passworddefault',
  'refreshtoken',
  'accesstoken',
  'token',
  'secret',
  'apikey',
  'api_key',
  'masterkey',
  'masterpassword',
  'authorization',
  'jwt',
];

const REDACTED = '***';

/** Shape của các dòng tổng hợp trả về từ getRawMany() */
interface MenuCountRow {
  menu_path: string | null;
  menu_title: string | null;
  menu_group: string | null;
  count: string | number;
}

interface ActionCountRow {
  action: ActivityAction;
  count: string | number;
}

interface UserCountRow {
  user_id: number | null;
  username_snapshot: string | null;
  full_name_snapshot: string | null;
  count: string | number;
}

@Injectable()
export class ActivityLogService {
  constructor(
    @InjectRepository(ActivityLog)
    private readonly activityLogRepository: Repository<ActivityLog>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Ghi một sự kiện thao tác.
   */
  async create(
    dto: CreateActivityLogDto,
    ctx: ActivityLogContext,
  ): Promise<ActivityLog> {
    const entity = this.buildEntity(dto, ctx);
    const saved = await this.activityLogRepository.save(entity);
    return saved;
  }

  /**
   * Ghi nhiều sự kiện cùng lúc — dùng cho batch từ frontend.
   * Lỗi ở một phần tử không được làm hỏng cả batch.
   */
  async createMany(
    dtos: CreateActivityLogDto[],
    ctx: ActivityLogContext,
  ): Promise<number> {
    if (!dtos?.length) return 0;

    const entities = dtos.map((dto) => this.buildEntity(dto, ctx));
    await this.activityLogRepository.save(entities);
    return entities.length;
  }

  /**
   * Lấy danh sách bản ghi theo bộ lọc (dành cho Admin).
   */
  async query(filter: QueryActivityLogDto) {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize =
      filter.pageSize && filter.pageSize > 0
        ? Math.min(filter.pageSize, 200)
        : 20;

    const qb = this.activityLogRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.user', 'user')
      .orderBy('log.occurred_at', 'DESC')
      .addOrderBy('log.id', 'DESC');

    this.applyFilters(qb, filter);

    const [data, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return { data, total, page, pageSize };
  }

  /**
   * Chi tiết một bản ghi (dành cho Admin).
   */
  async findOne(id: number): Promise<ActivityLog> {
    const log = await this.activityLogRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!log) {
      throw new NotFoundException(`Không tìm thấy bản ghi thao tác #${id}`);
    }

    return log;
  }

  /**
   * Tổng hợp: số thao tác theo menu và theo loại thao tác.
   */
  async stats(filter: QueryActivityLogDto) {
    const byMenuQb = this.activityLogRepository.createQueryBuilder('log');
    this.applyFilters(byMenuQb, filter);
    const byMenu = await byMenuQb
      .select('log.menu_path', 'menu_path')
      .addSelect('log.menu_title', 'menu_title')
      .addSelect('log.menu_group', 'menu_group')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.menu_path')
      .addGroupBy('log.menu_title')
      .addGroupBy('log.menu_group')
      .orderBy('count', 'DESC')
      .getRawMany<MenuCountRow>();

    const byActionQb = this.activityLogRepository.createQueryBuilder('log');
    this.applyFilters(byActionQb, filter);
    const byAction = await byActionQb
      .select('log.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.action')
      .orderBy('count', 'DESC')
      .getRawMany<ActionCountRow>();

    const byUserQb = this.activityLogRepository.createQueryBuilder('log');
    this.applyFilters(byUserQb, filter);
    const byUser = await byUserQb
      .select('log.user_id', 'user_id')
      .addSelect('log.username_snapshot', 'username_snapshot')
      .addSelect('log.full_name_snapshot', 'full_name_snapshot')
      .addSelect('COUNT(*)', 'count')
      .groupBy('log.user_id')
      .addGroupBy('log.username_snapshot')
      .addGroupBy('log.full_name_snapshot')
      .orderBy('count', 'DESC')
      .limit(20)
      .getRawMany<UserCountRow>();

    const totalQb = this.activityLogRepository.createQueryBuilder('log');
    this.applyFilters(totalQb, filter);
    const total = await totalQb.getCount();

    return {
      total,
      byMenu: byMenu.map((r) => ({
        menu_path: r.menu_path,
        menu_title: r.menu_title,
        menu_group: r.menu_group,
        count: Number(r.count),
      })),
      byAction: byAction.map((r) => ({
        action: r.action,
        count: Number(r.count),
      })),
      byUser: byUser.map((r) => ({
        user_id: r.user_id,
        username: r.username_snapshot,
        fullName: r.full_name_snapshot,
        count: Number(r.count),
      })),
    };
  }

  /**
   * Danh sách user để frontend chọn trong bộ lọc "chọn user".
   */
  async listUsers(search?: string) {
    const qb = this.userRepository
      .createQueryBuilder('u')
      .select([
        'u.id',
        'u.username',
        'u.fullName',
        'u.employeeCode',
        'u.avatarZalo',
      ])
      .orderBy('u.fullName', 'ASC')
      .limit(200);

    if (search && search.trim()) {
      const keyword = `%${search.trim()}%`;
      qb.andWhere(
        '(u.username LIKE :keyword OR u.full_name LIKE :keyword OR u.employee_code LIKE :keyword)',
        { keyword },
      );
    }

    const users = await qb.getMany();
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      employeeCode: u.employeeCode,
      avatarZalo: u.avatarZalo,
    }));
  }

  /**
   * Áp dụng bộ lọc cho query builder.
   */
  private applyFilters(
    qb: SelectQueryBuilder<ActivityLog>,
    filter: QueryActivityLogDto,
  ) {
    if (filter.user_id) {
      qb.andWhere('log.user_id = :userId', { userId: filter.user_id });
    }

    if (filter.menu_path) {
      qb.andWhere('log.menu_path = :menuPath', { menuPath: filter.menu_path });
    }

    if (filter.menu_group) {
      qb.andWhere('log.menu_group = :menuGroup', {
        menuGroup: filter.menu_group,
      });
    }

    if (filter.action) {
      qb.andWhere('log.action = :action', { action: filter.action });
    }

    if (filter.entity_id) {
      qb.andWhere('log.entity_id = :entityId', { entityId: filter.entity_id });
    }

    const from = this.parseBoundary(filter.from, false);
    if (from) {
      qb.andWhere('log.occurred_at >= :from', { from });
    }

    const to = this.parseBoundary(filter.to, true);
    if (to) {
      qb.andWhere('log.occurred_at <= :to', { to });
    }

    if (filter.search && filter.search.trim()) {
      const keyword = `%${filter.search.trim()}%`;
      qb.andWhere(
        '(log.description LIKE :keyword OR log.menu_title LIKE :keyword OR log.menu_path LIKE :keyword OR log.entity LIKE :keyword OR log.entity_id LIKE :keyword OR log.username_snapshot LIKE :keyword OR log.full_name_snapshot LIKE :keyword)',
        { keyword },
      );
    }
  }

  /**
   * Chuyển chuỗi ngày thành mốc thời gian theo giờ Việt Nam (UTC+7).
   *
   * - Chuỗi chỉ có ngày ('2026-10-21'): from -> 00:00:00.000, to -> 23:59:59.999
   * - Chuỗi ISO đầy đủ: dùng đúng offset có sẵn
   */
  private parseBoundary(value?: string, isEnd = false): Date | null {
    if (!value) return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(
        isEnd
          ? `${trimmed}T23:59:59.999+07:00`
          : `${trimmed}T00:00:00.000+07:00`,
      );
    }

    const parsed = new Date(trimmed);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Dựng entity từ DTO + context, đã redact field nhạy cảm.
   */
  private buildEntity(
    dto: CreateActivityLogDto,
    ctx: ActivityLogContext,
  ): ActivityLog {
    const entity = new ActivityLog();

    entity.user_id = ctx.userId ?? null;
    entity.username_snapshot = ctx.username ?? null;
    entity.full_name_snapshot = ctx.fullName ?? null;
    entity.ip_address = ctx.ipAddress ?? null;
    entity.user_agent = ctx.userAgent?.slice(0, 255) ?? null;

    entity.menu_path = dto.menu_path ?? null;
    entity.menu_title = dto.menu_title ?? null;
    entity.menu_group = dto.menu_group ?? null;
    entity.action = dto.action ?? ActivityAction.VIEW;
    entity.entity = dto.entity ?? null;
    entity.entity_id = dto.entity_id ?? null;
    entity.description = dto.description ?? null;

    entity.changed_fields = dto.changed_fields?.length
      ? dto.changed_fields.slice(0, 100)
      : null;
    entity.old_values = this.redact(dto.old_values);
    entity.new_values = this.redact(dto.new_values);

    const occurredAt = dto.occurred_at ? new Date(dto.occurred_at) : new Date();
    entity.occurred_at = isNaN(occurredAt.getTime()) ? new Date() : occurredAt;

    return entity;
  }

  /**
   * Thay thế giá trị của các field nhạy cảm trước khi lưu.
   */
  private redact(
    values?: Record<string, any> | null,
  ): Record<string, any> | null {
    if (!values || typeof values !== 'object') return null;

    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(values)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
      result[key] = SENSITIVE_FIELDS.includes(normalized) ? REDACTED : value;
    }
    return result;
  }
}

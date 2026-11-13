import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';

/**
 * Hình dạng user tối thiểu mà scope cần. Controller truyền `req.user` (any)
 * nhưng service chỉ đọc các trường dưới đây.
 */
export interface KpiUser {
  id?: number;
  roles?: Array<string | { name?: string }>;
  departments?: Array<{
    id?: number;
    slug?: string;
    server_ip?: string | null;
  }>;
}

/**
 * Phạm vi xem KPI dùng chung cho báo cáo hiện tại và các service chuẩn hóa mới.
 *
 * Luật (giữ nguyên như CustomerKpiReportsService.scopeUserIds):
 *   admin / view / pm-khach-hang -> toàn công ty
 *   manager-<phòng>              -> người trong các phòng ban CÓ server_ip
 *   còn lại                      -> chỉ chính mình
 *
 * Tách ra service riêng để KpiCoverageService không phải copy logic và để
 * tránh phụ thuộc ngược vào CustomerKpiReportsService (service rất lớn).
 */
@Injectable()
export class KpiScopeService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  roleNames(user: KpiUser | null | undefined): string[] {
    return (user?.roles ?? []).map((role) =>
      (typeof role === 'string' ? role : (role?.name ?? '')).toLowerCase(),
    );
  }

  isAdminOrPm(user: KpiUser | null | undefined): boolean {
    const roles = this.roleNames(user);
    return roles.includes('admin') || roles.includes('pm-khach-hang');
  }

  /** Quản lý phòng ban (`manager-<slug>`) — chỉ thấy người trong phòng có server_ip. */
  isManager(user: KpiUser | null | undefined): boolean {
    return this.roleNames(user).some((role) => role.startsWith('manager-'));
  }

  /**
   * Slug các phòng ban CÓ `server_ip` mà user thuộc về. Phòng không có IP chỉ
   * mang tính tượng trưng (Chiến dịch, Dev...) — không thuộc phạm vi KPI.
   */
  managedDepartmentSlugs(user: KpiUser | null | undefined): string[] {
    return (user?.departments ?? [])
      .filter((d) => d?.server_ip && String(d.server_ip).trim() !== '')
      .map((d) => String(d?.slug ?? '').trim())
      .filter(Boolean);
  }

  /**
   * Quyền ghi KPI (tính lại, nhập thưởng, duyệt khiếu nại):
   * admin / pm-khach-hang / manager-<phòng>. Manager vẫn bị giới hạn bởi
   * `scopeUserIds` khi thao tác trên một sale cụ thể.
   */
  canWriteKpi(user: KpiUser | null | undefined): boolean {
    return this.isAdminOrPm(user) || this.isManager(user);
  }

  async scopeUserIds(
    user: KpiUser | null | undefined,
  ): Promise<number[] | undefined> {
    if (!user?.id) {
      throw new ForbiddenException('Không xác định được người dùng');
    }
    const lower = this.roleNames(user);
    if (
      lower.includes('admin') ||
      lower.includes('view') ||
      lower.includes('pm-khach-hang')
    ) {
      return undefined;
    }
    if (lower.some((r) => r.startsWith('manager-'))) {
      const departmentIds = (user.departments ?? [])
        .filter((d) => d?.server_ip && String(d.server_ip).trim() !== '')
        .map((d) => d?.id)
        .filter((id): id is number => typeof id === 'number');
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

  assertSaleInScope(saleId: number, userIds: number[] | undefined): void {
    if (userIds !== undefined && !userIds.includes(saleId)) {
      throw new ForbiddenException('Bạn không có quyền xem sale này');
    }
  }
}

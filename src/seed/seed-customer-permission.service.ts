import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from '../permissions/permission.entity';
import { Role } from '../roles/role.entity';
import { RolePermission } from '../roles_permissions/roles-permissions.entity';

/**
 * Đăng ký nhóm quyền "khách hàng" (slug: khach-hang) vào cơ chế phân quyền
 * sẵn có — sao đúng mẫu department.service.ts tạo phòng ban:
 *   1. Dòng permission { name: slug, action } cho từng action
 *   2. Role manager-<slug> / user-<slug> / pm-<slug>
 *   3. roles_permissions: bật/tắt action theo vai trò
 *
 * PermissionGuard chỉ chặn qua permission + role, nên slug này KHÔNG cần tạo
 * phòng ban thật — nó là slug chức năng.
 *
 * Quy tắc bật quyền (theo thiết kế phần vai trò):
 * - admin  : tất cả (tạo thẳng + duyệt mọi thứ)
 * - manager: tất cả (sửa thẳng người trong phòng, duyệt đề xuất, đề xuất chỉ tiêu)
 *   — import để tắt, nạp Excel là việc của admin
 * - user   : xem + đề xuất thêm/sửa/xoá (sửa vẫn chờ duyệt) — import tắt
 * - pm     : xem + xuất báo cáo
 */
@Injectable()
export class SeedCustomerPermissionService {
  private readonly logger = new Logger(SeedCustomerPermissionService.name);

  private static readonly SLUG = 'khach-hang';
  private static readonly ACTIONS = [
    'create',
    'read',
    'update',
    'delete',
    'import',
    'export',
    'approve',
  ];
  private static readonly ROLES: Array<{
    name: string;
    display_name: string;
    activeActions: string[];
  }> = [
    {
      name: 'manager-khach-hang',
      display_name: 'Trưởng phòng nhóm Khách hàng',
      activeActions: ['create', 'read', 'update', 'delete', 'export', 'approve'],
    },
    {
      name: 'user-khach-hang',
      display_name: 'Nhân viên nhóm Khách hàng',
      activeActions: ['read', 'create', 'update', 'delete'],
    },
    {
      name: 'pm-khach-hang',
      display_name: 'Ban quản lý nhóm Khách hàng',
      activeActions: ['read', 'export'],
    },
  ];

  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
  ) {}

  async seedCustomerPermissions() {
    try {
      const permissions = await this.seedPermissions();
      await this.seedRoles(permissions);
      this.logger.log('✅ [SeedCustomerPermission] Nhóm quyền "khách hàng" đã sẵn sàng');
    } catch (error) {
      this.logger.error(
        `❌ [SeedCustomerPermission] Lỗi seed nhóm quyền khách hàng: ${error.message}`,
      );
    }
  }

  /** Tạo/đảm bảo các dòng permission + gán cho role admin (bật tất cả). */
  private async seedPermissions(): Promise<Permission[]> {
    const result: Permission[] = [];
    for (const action of SeedCustomerPermissionService.ACTIONS) {
      let permission = await this.permissionRepo.findOne({
        where: { name: SeedCustomerPermissionService.SLUG, action },
        withDeleted: true,
      });
      if (permission?.deletedAt) {
        await this.permissionRepo.restore({ id: permission.id });
        permission.deletedAt = null as any;
      } else if (!permission) {
        permission = await this.permissionRepo.save(
          this.permissionRepo.create({
            name: SeedCustomerPermissionService.SLUG,
            action,
          }),
        );
      }
      result.push(permission);

      // admin được tất cả — theo đúng createPermission của PermissionService
      const adminRole = await this.roleRepo.findOne({ where: { name: 'admin' } });
      if (adminRole) {
        await this.ensureRolePermission(adminRole, permission, true);
      }
    }
    return result;
  }

  private async seedRoles(permissions: Permission[]) {
    for (const roleDef of SeedCustomerPermissionService.ROLES) {
      let role = await this.roleRepo.findOne({ where: { name: roleDef.name } });
      if (!role) {
        role = await this.roleRepo.save(
          this.roleRepo.create({
            name: roleDef.name,
            display_name: roleDef.display_name,
          }),
        );
        this.logger.log(`✅ [SeedCustomerPermission] Đã tạo role: ${roleDef.name}`);
      }
      for (const permission of permissions) {
        await this.ensureRolePermission(
          role,
          permission,
          roleDef.activeActions.includes(permission.action),
        );
      }
    }
  }

  private async ensureRolePermission(
    role: Role,
    permission: Permission,
    isActive: boolean,
  ) {
    const existed = await this.rolePermissionRepo.findOne({
      where: { role: { id: role.id }, permission: { id: permission.id } },
      withDeleted: true,
    });
    if (!existed) {
      await this.rolePermissionRepo.save(
        this.rolePermissionRepo.create({ role, permission, isActive }),
      );
      return;
    }
    if (existed.deletedAt) {
      await this.rolePermissionRepo.restore({ id: existed.id });
    }
    if (existed.isActive !== isActive) {
      await this.rolePermissionRepo.update(
        { id: existed.id },
        { isActive },
      );
    }
  }

  /** Tiện dụng cho test/migrate: liệt kê id các permission của slug này. */
  async getPermissionIds(): Promise<number[]> {
    const rows = await this.permissionRepo.find({
      where: { name: SeedCustomerPermissionService.SLUG },
      select: ['id'],
    });
    return rows.map((r) => r.id);
  }
}

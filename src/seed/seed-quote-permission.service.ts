import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Permission } from '../permissions/permission.entity';
import { Role } from '../roles/role.entity';
import { RolePermission } from '../roles_permissions/roles-permissions.entity';

/**
 * Đăng ký nhóm quyền "báo giá" (slug: bao-gia) vào hệ thống phân quyền:
 * 1. Permission { name: 'bao-gia', action: 'read' }
 * 2. Gán quyền cho role admin (bật tất cả)
 */
@Injectable()
export class SeedQuotePermissionService {
  private readonly logger = new Logger(SeedQuotePermissionService.name);

  private static readonly SLUG = 'bao-gia';
  private static readonly ACTIONS = ['read'];

  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
  ) {}

  async seedQuotePermissions() {
    try {
      // Dọn dẹp / vô hiệu hóa các action thừa ngoài read (nếu có)
      await this.permissionRepo.softDelete({
        name: SeedQuotePermissionService.SLUG,
        action: In(['create', 'update', 'delete', 'export']),
      });

      const permissions = await this.seedPermissions();
      this.logger.log(
        '✅ [SeedQuotePermission] Quyền "báo giá:read" đã sẵn sàng',
      );
    } catch (error) {
      this.logger.error(
        `❌ [SeedQuotePermission] Lỗi seed nhóm quyền báo giá: ${error.message}`,
      );
    }
  }

  /** Tạo/đảm bảo các dòng permission + gán cho role admin (bật tất cả). */
  private async seedPermissions(): Promise<Permission[]> {
    const result: Permission[] = [];
    for (const action of SeedQuotePermissionService.ACTIONS) {
      let permission = await this.permissionRepo.findOne({
        where: { name: SeedQuotePermissionService.SLUG, action },
        withDeleted: true,
      });
      if (permission?.deletedAt) {
        await this.permissionRepo.restore({ id: permission.id });
        permission.deletedAt = null as any;
      } else if (!permission) {
        permission = await this.permissionRepo.save(
          this.permissionRepo.create({
            name: SeedQuotePermissionService.SLUG,
            action,
          }),
        );
      }
      result.push(permission);

      // admin được tất cả các action
      const adminRole = await this.roleRepo.findOne({
        where: { name: 'admin' },
      });
      if (adminRole) {
        await this.ensureRolePermission(adminRole, permission, true);
      }
    }
    return result;
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
      await this.rolePermissionRepo.update({ id: existed.id }, { isActive });
    }
  }

  async getPermissionIds(): Promise<number[]> {
    const rows = await this.permissionRepo.find({
      where: { name: SeedQuotePermissionService.SLUG },
      select: ['id'],
    });
    return rows.map((r) => r.id);
  }
}

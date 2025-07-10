import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Permission } from './permission.entity';
import { In, Repository } from 'typeorm';
import { Role } from '../roles/role.entity';
import { RolePermission } from '../roles_permissions/roles-permissions.entity';
import { getRoleNames } from '../common/utils/user-permission.helper';

@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
  ) {}

  async findAll(user: any): Promise<Permission[]> {
    // Có thể kiểm tra quyền ở đây nếu cần
    // if (!getRoleNames(user).includes('admin')) throw new UnauthorizedException('Chỉ admin được xem danh sách permission');
    return this.permissionRepo.find();
  }

  async createPermission(dto: { name: string; action: string }) {
    // Kiểm tra trùng permission
    let permission = await this.permissionRepo.findOne({ where: dto });
    if (!permission) {
      permission = this.permissionRepo.create(dto);
      permission = await this.permissionRepo.save(permission);
    }

    const adminRole = await this.roleRepo.findOne({ where: { name: 'admin' } });
    if (adminRole) {
      // Kiểm tra trùng mapping role-permission
      const existed = await this.rolePermissionRepo.findOne({
        where: {
          role: { id: adminRole.id },
          permission: { id: permission.id },
        },
      });
      if (!existed) {
        const rolePermission = this.rolePermissionRepo.create({
          role: adminRole,
          permission: permission,
          isActive: true,
        });
        await this.rolePermissionRepo.save(rolePermission);
      }
    }

    return permission;
  }

  async updatePermissionNameBySlug(oldSlug: string, newSlug: string) {
    await this.permissionRepo.update({ name: oldSlug }, { name: newSlug });
  }

  async softDeletePermissionsBySlug(slug: string) {
    // Xóa mềm permissions
    const permissions = await this.permissionRepo.find({
      where: { name: slug },
    });
    const permissionIds = permissions.map((p) => p.id);
    if (permissionIds.length) {
      await this.permissionRepo.softDelete({ name: slug });
      // Xóa mềm roles_permissions liên quan
      await this.rolePermissionRepo.softDelete({
        permission: { id: In(permissionIds) },
      });
    }
  }

  async restorePermissionsAndRolePermissionsBySlug(slug: string) {
    // Khôi phục permissions theo slug
    await this.permissionRepo.restore({ name: slug });

    // Lấy lại các permission id vừa khôi phục (kể cả đã xóa mềm)
    const permissions = await this.permissionRepo.find({
      where: { name: slug },
      withDeleted: true,
    });
    const permissionIds = permissions.map((p) => p.id);

    // Khôi phục roles_permissions liên quan
    if (permissionIds.length) {
      await this.rolePermissionRepo.restore({
        permission: { id: In(permissionIds) },
      });
    }
  }
}

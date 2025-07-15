import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { RolePermission } from './roles-permissions.entity';
import { CreateRolePermissionDto } from './dto/create-roles-permissions.dto';

@Injectable()
export class RolesPermissionsService {
  constructor(
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
  ) {}

  async bulkUpdate(permissions: any[]): Promise<RolePermission[]> {
    if (!permissions || permissions.length === 0) return [];
    const results: RolePermission[] = [];
    for (const item of permissions) {
      const { roleId, permissionId, isActive } = item;
      const rolePermission = await this.rolePermissionRepo.findOne({
        where: {
          role: { id: roleId },
          permission: { id: permissionId },
        },
        withDeleted: true,
      });
      if (rolePermission) {
        // Nếu đã có, chỉ update isActive
        rolePermission.isActive = isActive;
        await this.rolePermissionRepo.save(rolePermission);
        results.push(rolePermission);
      } else {
        // Nếu chưa có, tạo mới
        const newRolePermission = this.rolePermissionRepo.create({
          role: { id: roleId },
          permission: { id: permissionId },
          isActive,
        });
        await this.rolePermissionRepo.save(newRolePermission);
        results.push(newRolePermission);
      }
    }
    return results;
  }

  async findAll(): Promise<any[]> {
    const list = await this.rolePermissionRepo.find({
      relations: ['role', 'permission'],
    });
    return list.map((item) => ({
      id: item.id,
      roleId: item.role?.id,
      permissionId: item.permission?.id,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      deletedAt: item.deletedAt,
    }));
  }

  async findOne(id: number): Promise<RolePermission | null> {
    return this.rolePermissionRepo.findOneBy({ id });
  }

  async updateIsActive(
    id: number,
    isActive: boolean,
  ): Promise<RolePermission | null> {
    await this.rolePermissionRepo.update(id, { isActive });
    return this.rolePermissionRepo.findOneBy({ id });
  }

  async remove(id: number): Promise<void> {
    await this.rolePermissionRepo.delete(id);
  }

  async findByRoleIds(roleIds: number[]): Promise<RolePermission[]> {
    if (!roleIds || roleIds.length === 0) return [];
    return this.rolePermissionRepo.find({
      where: { role: { id: In(roleIds) } },
      relations: ['role', 'permission'],
      withDeleted: true,
    });
  }
}

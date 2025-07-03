import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Permission } from './permission.entity';
import { Repository } from 'typeorm';
import { Role } from '../roles/role.entity';
import { RolePermission } from '../roles_permissions/roles-permissions.entity';

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

  async findAll(token: string): Promise<Permission[]> {
    return this.permissionRepo.find();
  }

  async createPermission(dto: { name: string; action: string }) {
    const permission = this.permissionRepo.create(dto);
    const savedPermission = await this.permissionRepo.save(permission);

    const adminRole = await this.roleRepo.findOne({ where: { name: 'admin' } });
    if (adminRole) {
      const rolePermission = this.rolePermissionRepo.create({
        role: adminRole,
        permission: savedPermission,
        isActive: true,
      });
      await this.rolePermissionRepo.save(rolePermission);
    }

    return savedPermission;
  }
}

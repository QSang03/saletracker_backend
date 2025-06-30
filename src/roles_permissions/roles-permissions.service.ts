import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RolePermission } from './roles-permissions.entity';
import { CreateRolePermissionDto } from './dto/create-roles-permissions.dto';

@Injectable()
export class RolesPermissionsService {
  constructor(
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
  ) {}

  async bulkUpdate(permissions: Partial<RolePermission>[]): Promise<RolePermission[]> {
    await this.rolePermissionRepo.delete({});
    const newPermissions = this.rolePermissionRepo.create(permissions);
    return this.rolePermissionRepo.save(newPermissions);
  }

  async findAll(): Promise<RolePermission[]> {
    return this.rolePermissionRepo.find();
  }

  async findOne(id: number): Promise<RolePermission | null> {
    return this.rolePermissionRepo.findOneBy({ id });
  }

  async updateIsActive(id: number, isActive: boolean): Promise<RolePermission | null> {
    await this.rolePermissionRepo.update(id, { isActive });
    return this.rolePermissionRepo.findOneBy({ id });
  }

  async remove(id: number): Promise<void> {
    await this.rolePermissionRepo.delete(id);
  }
}

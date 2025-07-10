import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Role } from './role.entity';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { getRoleNames } from '../common/utils/user-permission.helper';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
  ) {}

  private checkAdmin(user: any) {
    if (!getRoleNames(user).includes('admin')) {
      throw new UnauthorizedException(
        'Chỉ admin mới được phép thực hiện thao tác này',
      );
    }
  }

  async findAll(user: any): Promise<{ id: number; name: string }[]> {
    if (getRoleNames(user).includes('admin')) {
      return this.roleRepo.find({
        select: { id: true, name: true },
        order: { id: 'ASC' },
      });
    }

    if (getRoleNames(user).includes('manager')) {
      // Lấy danh sách slug phòng ban của manager
      const managerDepartments = user.departments ?? [];
      const departmentSlugs = managerDepartments.map((d: any) => d.slug);

      // Lấy các role có permission.name thuộc departmentSlugs (qua bảng nối)
      return this.roleRepo
        .createQueryBuilder('role')
        .leftJoin('role.rolePermissions', 'rolePermission')
        .leftJoin('rolePermission.permission', 'permission')
        .where('role.name != :admin', { admin: 'admin' })
        .andWhere('permission.name IN (:...slugs)', { slugs: departmentSlugs })
        .select(['role.id', 'role.name'])
        .orderBy('role.id', 'ASC')
        .getMany();
    }

    throw new UnauthorizedException('Bạn không có quyền xem role');
  }

  async createRole(createRoleDto: CreateRoleDto, user: any): Promise<Role> {
    this.checkAdmin(user);
    const role = this.roleRepo.create(createRoleDto);
    return this.roleRepo.save(role);
  }

  async updateRole(
    id: number,
    updateRoleDto: UpdateRoleDto,
    user: any,
  ): Promise<Role> {
    this.checkAdmin(user);
    await this.roleRepo.update(id, updateRoleDto);
    return this.roleRepo.findOneOrFail({
      where: { id },
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });
  }

  async softDeleteRole(id: number, user: any): Promise<void> {
    this.checkAdmin(user);
    await this.roleRepo.softDelete(id);
  }

  async assignPermissionsToRole(
    roleId: number,
    permissionIds: number[],
    user: any,
  ): Promise<Role> {
    this.checkAdmin(user);
    const role = await this.roleRepo.findOneOrFail({
      where: { id: roleId },
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });
    // Giả sử bạn có Permission entity và repo, bạn cần lấy các permission theo id
    // const permissions = await this.permissionRepo.findByIds(permissionIds);
    // role.permissions = permissions;
    // await this.roleRepo.save(role);
    // return role;
    // Nếu chưa có permissionRepo, hãy bổ sung vào constructor và logic ở đây
    throw new Error(
      'Method not implemented. Cần bổ sung logic gán permission cho role.',
    );
  }

  async getGroupedRoles(user: any) {
    this.checkAdmin(user);
    const allRoles = await this.roleRepo.find();
    const main: { id: number; name: string }[] = [];
    const sub: { id: number; name: string; display_name: string }[] = [];
    for (const role of allRoles) {
      if (!role.display_name) {
        main.push({ id: role.id, name: role.name });
      } else {
        sub.push({
          id: role.id,
          name: role.name,
          display_name: role.display_name,
        });
      }
    }
    return { main, sub };
  }
}

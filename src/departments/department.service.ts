import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Department } from './department.entity';
import { Role } from '../roles/role.entity';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { JwtService } from '@nestjs/jwt';
import { PermissionService } from '../permissions/permission.service';
import { RolePermission } from '../roles_permissions/roles-permissions.entity';
import slugify from 'slugify';
import { Permission } from '../permissions/permission.entity';

@Injectable()
export class DepartmentService {
  constructor(
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    private readonly jwtService: JwtService,
    private readonly permissionService: PermissionService,
  ) {}

  async findAll(
    token: string,
    page = 1,
    pageSize = 20,
  ): Promise<{
    data: {
      id: number;
      name: string;
      slug: string;
      createdAt: Date;
      manager?: { id: number; fullName: string; username: string };
    }[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    let user: any;
    try {
      user = this.jwtService.decode(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    if (user?.roles?.includes('admin')) {
      const [departments, total] = await this.departmentRepo.findAndCount({
        relations: { users: { roles: true } },
        order: { id: 'ASC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });

      return {
        data: departments.map((dep) => {
          const manager = dep.users?.find((u) =>
            u.roles?.some((r) => r.name === `manager-${dep.slug}`),
          );
          return {
            id: dep.id,
            name: dep.name,
            slug: dep.slug,
            createdAt: dep.createdAt,
            manager: manager
              ? {
                  id: manager.id,
                  fullName:
                    typeof manager.fullName === 'string' &&
                    manager.fullName.trim() !== ''
                      ? manager.fullName
                      : manager.username || '',
                  username: manager.username || '',
                }
              : undefined,
          };
        }),
        total,
        page,
        pageSize,
      };
    }

    if (user?.roles?.includes('manager')) {
      if (!user.departments || !Array.isArray(user.departments))
        return { data: [], total: 0, page, pageSize };
      const [departments, total] = await this.departmentRepo.findAndCount({
        where: { id: In(user.departments.map((d) => d.id)) },
        relations: { users: { roles: true } },
        order: { id: 'ASC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return {
        data: departments.map((dep) => {
          const manager = dep.users?.find((u) =>
            u.roles?.some((r) => r.name === `manager-${dep.slug}`),
          );
          return {
            id: dep.id,
            name: dep.name,
            slug: dep.slug,
            createdAt: dep.createdAt,
            manager: manager
              ? {
                  id: manager.id,
                  fullName:
                    typeof manager.fullName === 'string' &&
                    manager.fullName.trim() !== ''
                      ? manager.fullName
                      : manager.username || '',
                  username: manager.username || '',
                }
              : undefined,
          };
        }),
        total,
        page,
        pageSize,
      };
    }

    throw new UnauthorizedException('Bạn không có quyền xem phòng ban');
  }

  async createDepartment(
    createDepartmentDto: CreateDepartmentDto,
    _token: string,
    token: string,
  ) {
    let user: any;
    try {
      user = this.jwtService.decode(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!user?.roles?.includes('admin')) {
      throw new UnauthorizedException('Chỉ admin mới được tạo phòng ban');
    }

    const slug = slugify(createDepartmentDto.name, {
      lower: true,
      strict: true,
    });

    const existed = await this.departmentRepo.findOne({ where: { slug } });
    if (existed) {
      throw new BadRequestException('Phòng ban đã tồn tại!');
    }

    // Tạo phòng ban mới
    const department = this.departmentRepo.create({
      ...createDepartmentDto,
      slug,
    });
    const savedDepartment = await this.departmentRepo.save(department);

    // Tạo roles cho phòng ban
    const managerRole = new Role();
    managerRole.name = `manager-${slug}`;
    managerRole.display_name = `Quản lý nhóm ${createDepartmentDto.name}`;

    const userRole = new Role();
    userRole.name = `user-${slug}`;
    userRole.display_name = `Nhân viên nhóm ${createDepartmentDto.name}`;

    // Lưu roles vào DB
    await this.departmentRepo.manager.save([managerRole, userRole]);

    // Tạo permissions cho phòng ban
    const actions = ['create', 'read', 'update', 'delete', 'import', 'export'];
    const permissions: Permission[] = [];
    for (const action of actions) {
      const permission = await this.permissionService.createPermission({
        name: slug,
        action,
      });
      permissions.push(permission);
    }

    // Gán tất cả quyền cho manager và user
    for (const permission of permissions) {
      // Gán cho manager: tất cả quyền đều bật
      const managerRolePermission = new RolePermission();
      managerRolePermission.role = managerRole;
      managerRolePermission.permission = permission;
      managerRolePermission.isActive = true;
      await this.departmentRepo.manager.save(managerRolePermission);

      // Gán cho user: chỉ bật quyền read, còn lại tắt
      const userRolePermission = new RolePermission();
      userRolePermission.role = userRole;
      userRolePermission.permission = permission;
      userRolePermission.isActive = permission.action === 'read';
      await this.departmentRepo.manager.save(userRolePermission);
    }

    return savedDepartment;
  }

  async updateDepartment(
    id: number,
    updateDepartmentDto: UpdateDepartmentDto,
    token: string,
  ) {
    let user: any;
    try {
      user = this.jwtService.decode(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!user?.roles?.includes('admin')) {
      throw new UnauthorizedException('Chỉ admin mới được sửa phòng ban');
    }

    const department = await this.departmentRepo.findOne({ where: { id } });
    if (!department) throw new NotFoundException('Không tìm thấy phòng ban');

    if (!updateDepartmentDto.name) {
      throw new BadRequestException('Tên phòng ban không được để trống!');
    }

    const newSlug = slugify(updateDepartmentDto.name, {
      lower: true,
      strict: true,
    });
    if (newSlug !== department.slug) {
      // Kiểm tra trùng slug
      const existed = await this.departmentRepo.findOne({
        where: { slug: newSlug },
      });
      if (existed) throw new BadRequestException('Phòng ban đã tồn tại!');
      // Cập nhật name của các permission liên quan thông qua PermissionService
      await this.permissionService.updatePermissionNameBySlug(
        department.slug,
        newSlug,
      );
      department.slug = newSlug;
    }
    department.name = updateDepartmentDto.name;
    await this.departmentRepo.save(department);
    return department;
  }

  async softDeleteDepartment(id: number, token: string) {
    let user: any;
    try {
      user = this.jwtService.decode(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!user?.roles?.includes('admin')) {
      throw new UnauthorizedException('Chỉ admin mới được xóa phòng ban');
    }

    const department = await this.departmentRepo.findOne({
      where: { id },
      relations: { users: true },
    });
    if (!department) throw new NotFoundException('Không tìm thấy phòng ban');

    if (department.users && department.users.length > 0) {
      throw new BadRequestException('Không thể xóa phòng ban còn thành viên!');
    }

    // Xóa mềm phòng ban
    await this.departmentRepo.softDelete(id);

    // Xóa mềm permissions và roles_permissions liên quan
    await this.permissionService.softDeletePermissionsBySlug(department.slug);

    return { success: true };
  }

  async restoreDepartment(id: number, token: string) {
    let user: any;
    try {
      user = this.jwtService.decode(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!user?.roles?.includes('admin')) {
      throw new UnauthorizedException('Chỉ admin mới được khôi phục phòng ban');
    }

    // Khôi phục phòng ban
    await this.departmentRepo.restore(id);

    // Khôi phục các permission liên quan (nếu có xóa mềm)
    const department = await this.departmentRepo.findOne({
      where: { id },
      withDeleted: true,
    });
    if (department) {
      await this.permissionService.restorePermissionsAndRolePermissionsBySlug(
        department.slug,
      );
    }

    return { success: true };
  }

  async findDeleted(token: string, page = 1, pageSize = 20) {
    let user: any;
    try {
      user = this.jwtService.decode(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!user?.roles?.includes('admin')) {
      throw new UnauthorizedException(
        'Chỉ admin mới được xem phòng ban đã xóa',
      );
    }

    const [departments, total] = await this.departmentRepo.findAndCount({
      withDeleted: true,
      where: { deletedAt: Not(IsNull()) },
      order: { deletedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      data: departments.map((dep) => ({
        id: dep.id,
        name: dep.name,
        slug: dep.slug,
        deletedAt: dep.deletedAt,
      })),
      total,
      page,
      pageSize,
    };
  }
}

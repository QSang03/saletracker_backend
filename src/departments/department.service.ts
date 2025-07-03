import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Department } from './department.entity';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { JwtService } from '@nestjs/jwt';
import { PermissionService } from 'src/permissions/permission.service';
import slugify from 'slugify';

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
  ): Promise<{ id: number; name: string; slug: string }[]> {
    let user: any;
    try {
      user = this.jwtService.decode(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (user?.roles?.includes('admin')) {
      return this.departmentRepo.find({
        select: { id: true, name: true, slug: true },
        order: { id: 'ASC' },
      });
    }
    if (user?.roles?.includes('manager')) {
      if (!user.departments || !Array.isArray(user.departments)) return [];
      return this.departmentRepo.find({
        where: { id: In(user.departments.map((d) => d.id)) },
        select: { id: true, name: true, slug: true },
        order: { id: 'ASC' },
      });
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
      throw new UnauthorizedException(
        'Chỉ admin mới được lấy tất cả phòng ban',
      );
    }
    const slug = slugify(createDepartmentDto.name, {
      lower: true,
      strict: true,
    });
    const department = this.departmentRepo.create({
      ...createDepartmentDto,
      slug,
    });
    const savedDepartment = await this.departmentRepo.save(department);

    const actions = ['create', 'read', 'update', 'delete', 'import', 'export'];
    for (const action of actions) {
      await this.permissionService.createPermission({ name: slug, action });
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
      throw new UnauthorizedException(
        'Chỉ admin mới được lấy tất cả phòng ban',
      );
    }
    await this.departmentRepo.update(id, updateDepartmentDto);
    return this.departmentRepo.findOne({ where: { id } });
  }

  async softDeleteDepartment(id: number, token: string) {
    let user: any;
    try {
      user = this.jwtService.decode(token);
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
    if (!user?.roles?.some((role: any) => role.name === 'admin')) {
      throw new UnauthorizedException('Chỉ admin mới được xóa phòng ban');
    }
    await this.departmentRepo.softDelete(id);
    return { success: true };
  }
}

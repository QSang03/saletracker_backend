import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Role } from './role.entity';
import { UpdateRoleDto } from './dto/update-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    private readonly jwtService: JwtService,
  ) {}

  private checkAdmin(token: string) {
    const user: any = this.jwtService.decode(token);
    if (!user?.roles?.includes('admin')) {
      throw new UnauthorizedException(
        'Chỉ admin mới được phép thực hiện thao tác này',
      );
    }
  }

  async findAll(token: string): Promise<{ id: number; name: string }[]> {
    const user: any = this.jwtService.decode(token);
    if (user?.roles?.includes('admin')) {
      return this.roleRepo.find({
        select: { id: true, name: true },
        order: { id: 'ASC' },
      });
    }
    if (user?.roles?.includes('manager')) {
      return this.roleRepo.find({
        where: { name: Not('admin') },
        select: { id: true, name: true },
        order: { id: 'ASC' },
      });
    }
    throw new UnauthorizedException('Bạn không có quyền xem role');
  }

  async createRole(createRoleDto: CreateRoleDto, token: string): Promise<Role> {
    this.checkAdmin(token);
    const role = this.roleRepo.create(createRoleDto);
    return this.roleRepo.save(role);
  }

  async updateRole(
    id: number,
    updateRoleDto: UpdateRoleDto,
    token: string,
  ): Promise<Role> {
    this.checkAdmin(token);
    await this.roleRepo.update(id, updateRoleDto);
    return this.roleRepo.findOneOrFail({
      where: { id },
      relations: ['rolePermissions', 'rolePermissions.permission'],
    });
  }

  async softDeleteRole(id: number, token: string): Promise<void> {
    this.checkAdmin(token);
    await this.roleRepo.softDelete(id);
  }

  async assignPermissionsToRole(
    roleId: number,
    permissionIds: number[],
    token: string,
  ): Promise<Role> {
    this.checkAdmin(token);
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
}

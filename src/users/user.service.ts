import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { User } from './user.entity';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserPermissionsDto } from './dto/update-user-permissions.dto';
import { Role } from '../roles/role.entity';
import { Permission } from '../permissions/permission.entity';
import { UserStatus } from './user-status.enum';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,

    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,

    private readonly jwtService: JwtService,
  ) {}

  // 2. Phương thức lấy tất cả user
  async findAll(): Promise<User[]> {
    return this.userRepo.find({
      relations: ['roles', 'department'],
      where: {
        deletedAt: IsNull(),
      },
    });
  }

  // 3. Phương thức lấy một user theo ID
  async findOne(id: number): Promise<User | null> {
    if (isNaN(id) || !Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('Invalid user ID');
    }

    return this.userRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['roles', 'department'],
    });
  }

  // 4. Phương thức tìm user theo username
  async findByUsername(username: string): Promise<User | null> {
    return this.userRepo.findOne({
      where: { username },
      relations: ['roles', 'roles.permissions', 'permissions'],
      select: [
        'id',
        'username',
        'password',
        'roles',
        'permissions',
        'department',
      ],
    });
  }

  // 5. Phương thức tạo user mới
  async createUser(userData: CreateUserDto): Promise<User> {
    const hashedPassword = await bcrypt.hash(userData.password, 10);

    let roles: Role[] = [];
    if (userData.roleIds && userData.roleIds.length > 0) {
      roles = await this.roleRepo.findBy({ id: In(userData.roleIds) });
    }

    const userObj: Partial<User> = {
      username: userData.username,
      password: hashedPassword,
      roles: roles,
      fullName: userData.fullName,
      email: userData.email,
      phone: userData.phone,
      avatar: userData.avatar,
      status: userData.status || UserStatus.ACTIVE,
    };

    if (userData.departmentId) {
      userObj.department = { id: userData.departmentId } as any;
    }

    const newUser = this.userRepo.create(userObj);
    const savedUser = await this.userRepo.save(newUser);

    return this.userRepo.findOneOrFail({
      where: { id: savedUser.id },
      relations: ['roles', 'roles.permissions', 'department'],
    });
  }

  // 6. Phương thức cập nhật user
  async updateUser(id: number, updateData: UpdateUserDto): Promise<User> {
    const updatePayload: Partial<User> = {
      username: updateData.username,
      fullName: updateData.fullName,
      email: updateData.email,
      phone: updateData.phone,
      avatar: updateData.avatar,
      status: updateData.status,
    };

    if (updateData.password) {
      updatePayload.password = await bcrypt.hash(updateData.password, 10);
    }

    await this.userRepo.update(id, updatePayload);

    if (updateData.departmentId !== undefined) {
      await this.userRepo
        .createQueryBuilder()
        .relation(User, 'department')
        .of(id)
        .set(updateData.departmentId ? { id: updateData.departmentId } : null);
    }

    if (updateData.roleIds) {
      const roles = await this.roleRepo.findBy({ id: In(updateData.roleIds) });
      await this.userRepo
        .createQueryBuilder()
        .relation(User, 'roles')
        .of(id)
        .set(roles);
    }

    return this.userRepo.findOneOrFail({
      where: { id },
      relations: ['roles', 'department'],
    });
  }

  // 7. Phương thức xóa mềm user
  async softDeleteUser(id: number): Promise<void> {
    await this.userRepo.update(id, { deletedAt: new Date() });
  }

  // 8. Phương thức lấy user cho quản lý phân quyền
  async getUsersForPermissionManagement(): Promise<User[]> {
    return this.userRepo.find({
      relations: ['roles', 'department'],
      select: ['id', 'username', 'department'],
    });
  }

  // 9. Phương thức cập nhật phân quyền cho user
  async updateUserPermissions(
    userId: number,
    dto: UpdateUserPermissionsDto,
  ): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['roles', 'permissions'],
    });

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    const roles = await this.roleRepo.findBy({ id: In(dto.roleIds) });
    user.roles = roles;

    if (dto.permissionIds && dto.permissionIds.length > 0) {
      const permissions = await this.permissionRepo.findBy({
        id: In(dto.permissionIds),
      });
      user.permissions = permissions;
    } else {
      user.permissions = [];
    }

    return this.userRepo.save(user);
  }

  // 10. Phương thức gán vai trò cho user
  async assignRolesToUser(userId: number, roleIds: number[]): Promise<User> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['roles'],
    });

    if (!user) {
      throw new Error(`User with ID ${userId} not found`);
    }

    const roles = await this.roleRepo.findBy({ id: In(roleIds) });
    user.roles = roles;

    return this.userRepo.save(user);
  }

  async findOneWithDetails(id: number): Promise<User | null> {
    if (isNaN(id) || !Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('Invalid user ID');
    }

    return this.userRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['roles', 'roles.permissions', 'permissions', 'department'],
    });
  }
}

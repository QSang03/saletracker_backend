import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
  Req,
  NotFoundException,
  ForbiddenException,
  Query,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtUserPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { getRoleNames } from '../common/utils/user-permission.helper';
import { RolesPermissionsService } from '../roles_permissions/roles-permissions.service';
import { Permission } from 'src/common/guards/permission.decorator';

interface CustomRequest extends Request {
  user: JwtUserPayload;
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly rolesPermissionsService: RolesPermissionsService, // Inject service
  ) {}

  @Get()
  async findAll(
    @Req() req: CustomRequest,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('search') search?: string,
    @Query('departments') departments?: string,
    @Query('roles') roles?: string,
    @Query('statuses') statuses?: string,
    @Query('zaloLinkStatus') zaloLinkStatus?: string,
  ) {
    const currentUser = req.user;
    const user = await this.userService.findOneWithDetails(currentUser.id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Parse filter params
    const filter = {
      search,
      departments: departments ? departments.split(',') : [],
      roles: roles ? roles.split(',') : [],
      statuses: statuses ? statuses.split(',') : [],
      zaloLinkStatuses: zaloLinkStatus
        ? zaloLinkStatus.split(',').map((s) => parseInt(s, 10))
        : [],
    };

    if (getRoleNames(user).includes('admin')) {
      return this.userService.findAll(Number(page), Number(limit), filter);
    }

    if (getRoleNames(user).includes('manager')) {
      return this.userService.findUsersByDepartmentIds(
        user.departments?.map((d) => d.id) ?? [],
        Number(page),
        Number(limit),
        filter,
      );
    }

    return { data: [], total: 0 };
  }

  @Get('for-permission-management')
  async getUsersForPermissionManagement() {
    const users = await this.userService.getUsersForPermissionManagement();
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      departments: (user.departments ?? []).map((d) => ({
        id: d.id,
        name: d.name,
      })),
      roles: (user.roles ?? []).map((r) => ({ id: r.id, name: r.name })),
    }));
  }

  @Get('with-email')
  @Permission('chien-dich', 'read')
  async getUsersWithEmail(): Promise<
    Array<{ id: number; fullName: string; email: string }>
  > {
    return this.userService.getUsersWithEmail();
  }

  @Get('all-for-filter')
  @Permission('chien-dich', 'read')
  async getAllUsersForFilter(@Req() req) {
    return this.userService.getAllUsersForFilter(req.user);
  }

  @Get('for-filter')
  @Permission('chien-dich', 'read')
  async getUsersForFilter(
    @Req() req,
    @Query('department_id') departmentId?: string,
  ) {
    return this.userService.getUsersForFilter(req.user, departmentId);
  }

  @Get('change-logs')
  async getAllChangeUserLogs(
    @Req() req: CustomRequest,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('search') search?: string,
    @Query('departments') departments?: string,
  ) {
    const currentUser = req.user;
    const user = await this.userService.findOneWithDetails(currentUser.id);

    if (!user || !getRoleNames(user).includes('admin')) {
      throw new ForbiddenException('Bạn không có quyền xem lịch sử đổi tên');
    }

    return this.userService.getAllChangeUserLogs({
      page: Number(page),
      limit: Number(limit),
      search,
      departments: departments ? departments.split(',') : [],
    });
  }

  @Get(':id/change-logs')
  async getChangeUserLogByUser(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: CustomRequest,
  ) {
    const currentUser = req.user;
    const user = await this.userService.findOneWithDetails(currentUser.id);

    if (!user || !getRoleNames(user).includes('admin')) {
      throw new ForbiddenException('Bạn không có quyền xem lịch sử đổi tên');
    }

    return this.userService.getChangeUserLogByUser(id);
  }

  @Patch(':id/roles-permissions')
  async updateUserRolesPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      departmentIds: number[];
      roleIds: number[];
      permissionIds: number[];
      rolePermissions: {
        roleId: number;
        permissionId: number;
        isActive: boolean;
      }[];
    },
  ) {
    // Gọi service cập nhật roles, departments, permissions, role-permissions cho user
    await this.userService.updateUserRolesPermissions(
      id,
      body.departmentIds,
      body.roleIds,
      body.permissionIds,
      body.rolePermissions,
    );
    return { success: true };
  }

  @Post()
  async create(
    @Body() createUserDto: CreateUserDto,
    @Req() req: CustomRequest,
  ) {
    const currentUser = req.user;
    const user = await this.userService.findOneWithDetails(currentUser.id);

    if (!user || !getRoleNames(user).includes('admin')) {
      throw new ForbiddenException('Bạn không có quyền tạo user mới');
    }

    return this.userService.createUser(createUserDto);
  }

  @Get('deleted')
  async getDeletedUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Req() req: CustomRequest,
  ) {
    const currentUser = req.user;
    const user = await this.userService.findOneWithDetails(currentUser.id);

    if (!user || !getRoleNames(user).includes('admin')) {
      throw new ForbiddenException(
        'Bạn không có quyền xem danh sách user đã xóa',
      );
    }

    return this.userService.getDeletedUsers();
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @Req() req: CustomRequest,
  ) {
    const currentUser = req.user;
    const user = await this.userService.findOneWithDetails(currentUser.id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (getRoleNames(user).includes('admin')) {
      // Check if trying to block admin user or current user
      if (updateUserDto.isBlock !== undefined) {
        // Prevent blocking self
        if (id === currentUser.id) {
          throw new ForbiddenException('Bạn không thể khóa chính mình');
        }

        // Prevent blocking admin users
        const targetUser = await this.userService.findOneWithDetails(id);
        if (targetUser && getRoleNames(targetUser).includes('admin')) {
          throw new ForbiddenException('Không thể khóa tài khoản admin');
        }
      }

      // Admin đổi cho ai cũng truyền changerId là chính họ
      return this.userService.updateUser(id, updateUserDto, currentUser.id);
    }

    if (getRoleNames(user).includes('manager')) {
      if (id === user.id) {
        // Manager đổi cho chính mình
        return this.userService.updateUser(id, updateUserDto, currentUser.id);
      }
      const targetUser = await this.userService.findOneWithDetails(id);
      const managerDeptIds = user.departments?.map((d) => d.id) ?? [];
      const targetDeptIds = targetUser?.departments?.map((d) => d.id) ?? [];
      const isSameDept = targetDeptIds.some((deptId) =>
        managerDeptIds.includes(deptId),
      );
      if (!isSameDept) {
        throw new ForbiddenException(
          'Bạn chỉ được sửa user trong nhóm của mình',
        );
      }

      // Check if trying to block admin user
      if (
        updateUserDto.isBlock !== undefined &&
        targetUser &&
        getRoleNames(targetUser).includes('admin')
      ) {
        throw new ForbiddenException('Không thể khóa tài khoản admin');
      }

      // Manager đổi cho user trong nhóm
      return this.userService.updateUser(
        id,
        {
          ...updateUserDto,
          employeeCode: updateUserDto.employeeCode,
        } as UpdateUserDto,
        currentUser.id,
      );
    }

    if (id === user.id) {
      // User tự đổi: KHÔNG cho đổi fullName
      if (
        Object.prototype.hasOwnProperty.call(updateUserDto, 'fullName') &&
        typeof updateUserDto.fullName === 'string' &&
        updateUserDto.fullName !== user.fullName
      ) {
        throw new ForbiddenException('Bạn không có quyền đổi họ và tên');
      }
      // User tự đổi thông tin (có thể bao gồm đổi mật khẩu) - truyền changerId là chính user đó
      return this.userService.updateUser(id, updateUserDto, currentUser.id);
    }

    throw new ForbiddenException('Bạn không có quyền sửa user này');
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: CustomRequest,
  ) {
    const currentUser = req.user;
    const user = await this.userService.findOneWithDetails(currentUser.id);

    if (!user || !getRoleNames(user).includes('admin')) {
      throw new ForbiddenException('Bạn không có quyền xóa user này');
    }

    // Prevent deleting self
    if (id === currentUser.id) {
      throw new ForbiddenException('Bạn không thể xóa chính mình');
    }

    // Prevent deleting admin users
    const targetUser = await this.userService.findOneWithDetails(id);
    if (targetUser && getRoleNames(targetUser).includes('admin')) {
      throw new ForbiddenException('Không thể xóa tài khoản admin');
    }

    return this.userService.softDeleteUser(id);
  }

  @Patch(':id/restore')
  async restore(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: CustomRequest,
  ) {
    const currentUser = req.user;
    const user = await this.userService.findOneWithDetails(currentUser.id);

    if (!user || !getRoleNames(user).includes('admin')) {
      throw new ForbiddenException('Bạn không có quyền khôi phục user này');
    }

    return this.userService.restoreUser(id);
  }

  @Patch(':id/reset-password')
  async resetPasswordToDefault(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: CustomRequest,
  ) {
    const currentUser = req.user;
    const user = await this.userService.findOneWithDetails(currentUser.id);

    if (!user || !getRoleNames(user).includes('admin')) {
      throw new ForbiddenException(
        'Bạn không có quyền reset mật khẩu user này',
      );
    }

    return this.userService.resetPasswordToDefault(id);
  }

  @Post(':userId/roles')
  async assignRoles(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() roleIds: number[],
  ) {
    return this.userService.assignRolesToUser(userId, roleIds);
  }

  @Get(':id/roles-permissions')
  async getUserRolePermissions(@Param('id', ParseIntPipe) id: number) {
    // Lấy tất cả role-permission của user này (theo các role hiện tại của user)
    const user = await this.userService.findOneWithDetails(id);
    if (!user) throw new NotFoundException('User not found');
    const roleIds = user.roles?.map((r) => r.id) || [];
    if (roleIds.length === 0) return [];
    // Lấy tất cả role-permission mapping cho các role này
    return this.rolesPermissionsService.findByRoleIds(roleIds);
  }
}

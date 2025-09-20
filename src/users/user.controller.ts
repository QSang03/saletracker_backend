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
import { UserStatusObserver } from '../observers/user-status.observer';
import { forwardRef, Inject } from '@nestjs/common';
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
    @Inject(forwardRef(() => UserStatusObserver))
    private readonly userStatusObserver: UserStatusObserver,
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

    // Kiểm tra role "view" - cho phép xem tất cả users
    if (getRoleNames(user).includes('view')) {
      return this.userService.findAll(Number(page), Number(limit), filter);
    }

    if (getRoleNames(user).includes('admin')) {
      return this.userService.findAll(Number(page), Number(limit), filter);
    }

    if (getRoleNames(user).includes('manager')) {
      return this.userService.findUsersByDepartmentIds(
        user.departments?.map((d) => d.id) ?? [],
        Number(page),
        Number(limit),
        filter,
        true, // exclude view users for manager
      );
    }
    // Other non-admin roles: still can see users but exclude 'view' users
    return this.userService.findAll(
      Number(page),
      Number(limit),
      filter,
      user,
      true, // excludeViewUsers
    );
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
      viewSubRoleName?: string; // Thêm thông tin để tạo role "view con"
      pmPrivateRoleName?: string; // Thêm thông tin để tạo role "pm riêng" (pm_<username>)
      pmCustomRoleNames?: string[]; // Danh sách tên các PM custom roles
      pmCustomRolePermissions?: Array<{ roleName: string; permissions: number[] }>; // Quyền cho từng PM custom role
      pmMode?: 'general' | 'custom'; // Chế độ PM
    },
  ) {
    // Gọi service cập nhật roles, departments, permissions, role-permissions cho user
    await this.userService.updateUserRolesPermissions(
      id,
      body.departmentIds,
      body.roleIds,
      body.permissionIds,
      body.rolePermissions,
      body.viewSubRoleName, // Truyền thông tin tạo role "view con"
      body.pmPrivateRoleName, // Truyền thông tin tạo role pm riêng
      body.pmCustomRoleNames, // Truyền danh sách PM custom roles
      body.pmCustomRolePermissions, // Truyền quyền cho PM custom roles
      body.pmMode, // Truyền chế độ PM
    );
    return { success: true };
  }

  @Get(':id/permissions')
  async getUserPermissions(@Param('id', ParseIntPipe) id: number) {
    return this.userService.getUserPermissions(id);
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

  @Get(':id/zalo-link-status-logs')
  async getZaloLinkStatusLogs(
    @Param('id', ParseIntPipe) id: number,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
  ) {
    return this.userService.getZaloLinkStatusLogs(id, Number(page), Number(limit));
  }

  @Post(':id/trigger-zalo-link-error')
  @UseGuards(AdminAuthGuard)
  async triggerZaloLinkError(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { errorType?: string },
    @Req() req: CustomRequest,
  ) {
    const success = await this.userStatusObserver.triggerZaloLinkError(
      id, 
      body.errorType || 'manual_trigger',
      `admin_${req.user.id}`
    );
    
    if (success) {
      return {
        success: true,
        message: `Đã trigger lỗi liên kết cho user ${id}`,
        timestamp: new Date()
      };
    } else {
      return {
        success: false,
        message: `Không thể trigger lỗi liên kết cho user ${id}`,
        timestamp: new Date()
      };
    }
  }

  @Get('zalo-link-monitor/status')
  @UseGuards(AdminAuthGuard)
  async getZaloLinkMonitorStatus() {
    // Import ZaloLinkMonitorCronjob để lấy status
    const { ZaloLinkMonitorCronjob } = await import('../cronjobs/zalo-link-monitor.cronjob');
    return {
      message: 'Zalo Link Monitor đang chạy mỗi 30 giây',
      processedUsers: [], // Sẽ được implement sau
      timestamp: new Date()
    };
  }

  @Get('test-python-api')
  @UseGuards(AdminAuthGuard)
  async testPythonApi() {
    try {
      const pythonApiUrl = process.env.CONTACTS_API_BASE_URL || 'http://192.168.117.19:5555';
      const testPayload = {
        userId: 999,
        errorType: 'test',
        errorMessage: 'Test connection to Python API',
        userInfo: {
          username: 'test',
          fullName: 'Test User',
          email: 'test@example.com',
          employeeCode: 'TEST-001'
        }
      };

      const axios = await import('axios');
      const response = await axios.default.post(`${pythonApiUrl}/send-error-notification`, testPayload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.PYTHON_API_TOKEN || ''}`,
          'X-Master-Key': process.env.NEXT_PUBLIC_MASTER_KEY || process.env.MASTER_KEY || ''
        },
        timeout: 5000
      });

      return {
        success: true,
        message: 'Python API connection successful',
        response: response.data,
        timestamp: new Date()
      };

    } catch (error: any) {
      return {
        success: false,
        message: 'Python API connection failed',
        error: error.message,
        details: {
          url: `${process.env.CONTACTS_API_BASE_URL || 'http://192.168.117.19:5555'}/send-error-notification`,
          token: process.env.PYTHON_API_TOKEN ? 'Configured' : 'Not configured',
          responseStatus: error.response?.status || 'No response',
          responseData: error.response?.data || null,
          responseHeaders: error.response?.headers || null
        },
        timestamp: new Date()
      };
    }
  }

  @Get('test-python-api-real-user')
  @UseGuards(AdminAuthGuard)
  async testPythonApiWithRealUser() {
    try {
      const pythonApiUrl = process.env.CONTACTS_API_BASE_URL || 'http://192.168.117.19:5555';
      
      // Lấy user thật từ database để test
      const realUser = await this.userService.findOneWithDetails(12);
      if (!realUser) {
        return {
          success: false,
          message: 'User 12 not found',
          timestamp: new Date()
        };
      }

      const testPayload = {
        userId: realUser.id,
        errorType: 'session_invalid',
        errorMessage: 'Tài khoản đang lỗi liên kết',
        userInfo: {
          username: realUser.username,
          fullName: realUser.fullName,
          email: realUser.email,
          employeeCode: realUser.employeeCode || ''
        }
      };

      const axios = await import('axios');
      const response = await axios.default.post(`${pythonApiUrl}/send-error-notification`, testPayload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.PYTHON_API_TOKEN || ''}`,
          'X-Master-Key': process.env.NEXT_PUBLIC_MASTER_KEY || process.env.MASTER_KEY || ''
        },
        timeout: 5000
      });

      return {
        success: true,
        message: 'Python API connection successful with real user',
        payload: testPayload,
        response: response.data,
        timestamp: new Date()
      };

    } catch (error: any) {
      return {
        success: false,
        message: 'Python API connection failed with real user',
        error: error.message,
        details: {
          url: `${process.env.CONTACTS_API_BASE_URL || 'http://192.168.117.19:5555'}/send-error-notification`,
          token: process.env.PYTHON_API_TOKEN ? 'Configured' : 'Not configured',
          responseStatus: error.response?.status || 'No response',
          responseData: error.response?.data || null,
          responseHeaders: error.response?.headers || null
        },
        timestamp: new Date()
      };
    }
  }
}

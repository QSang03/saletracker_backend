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

interface CustomRequest extends Request {
  user: JwtUserPayload;
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async findAll(
    @Req() req: CustomRequest,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
    @Query('search') search?: string,
    @Query('departments') departments?: string,
    @Query('roles') roles?: string,
    @Query('statuses') statuses?: string,
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
    };

    if (user.roles?.some((role) => role.name === 'admin')) {
      return this.userService.findAll(Number(page), Number(limit), filter);
    }

    if (user.roles?.some((role) => role.name === 'manager')) {
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

  @Post()
  async create(
    @Body() createUserDto: CreateUserDto,
    @Req() req: CustomRequest,
  ) {
    const currentUser = req.user;
    const user = await this.userService.findOneWithDetails(currentUser.id);

    if (!user || !user.roles?.some((role) => role.name === 'admin')) {
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

    if (!user || !user.roles?.some((role) => role.name === 'admin')) {
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

    if (user.roles?.some((role) => role.name === 'admin')) {
      return this.userService.updateUser(id, updateUserDto);
    }

    if (user.roles?.some((role) => role.name === 'manager')) {
      if (id === user.id) {
        return this.userService.updateUser(id, updateUserDto);
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
      return this.userService.updateUser(id, {
        employeeCode: updateUserDto.employeeCode,
      } as UpdateUserDto);
    }

    if (id === user.id) {
      return this.userService.updateUser(id, updateUserDto);
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

    if (!user || !user.roles?.some((role) => role.name === 'admin')) {
      throw new ForbiddenException('Bạn không có quyền xóa user này');
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

    if (!user || !user.roles?.some((role) => role.name === 'admin')) {
      throw new ForbiddenException('Bạn không có quyền khôi phục user này');
    }

    return this.userService.restoreUser(id);
  }

  @Post(':userId/roles')
  async assignRoles(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() roleIds: number[],
  ) {
    return this.userService.assignRolesToUser(userId, roleIds);
  }
}

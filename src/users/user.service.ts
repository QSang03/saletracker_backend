import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, Not } from 'typeorm';
import { User } from './user.entity';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from '../roles/role.entity';
import { Department } from '../departments/department.entity';
import { UserStatus } from './user-status.enum';
import { ChangeUserLog } from './change-user-log.entity';
import { RolesPermissionsService } from '../roles_permissions/roles-permissions.service';
import { UserStatusObserver } from '../observers/user-status.observer';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(ChangeUserLog)
    private readonly changeUserLogRepo: Repository<ChangeUserLog>,
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly wsGateway: WebsocketGateway,
    private readonly rolesPermissionsService: RolesPermissionsService, // Inject service
    private readonly userStatusObserver: UserStatusObserver,
    
  ) {}

  async findAll(
    page = 1,
    limit = 10,
    filter?: {
      search?: string;
      departments?: string[];
      roles?: string[];
      statuses?: string[];
      zaloLinkStatuses?: number[];
    },
    user?: any, // Thêm user để phân quyền động nếu cần
  ): Promise<{ data: Array<{ [key: string]: any }>; total: number }> {
    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.departments', 'department')
      .leftJoinAndSelect('user.roles', 'role')
      .where('user.deletedAt IS NULL');

    if (filter) {
      if (filter.search) {
        qb.andWhere(
          '(user.fullName LIKE :search OR user.username LIKE :search OR user.email LIKE :search OR user.employeeCode LIKE :search OR user.zaloName LIKE :search)',
          { search: `%${filter.search}%` },
        );
      }
      if (filter.departments && filter.departments.length > 0) {
        qb.andWhere('department.name IN (:...departments)', {
          departments: filter.departments,
        });
      }
      if (filter.roles && filter.roles.length > 0) {
        qb.andWhere('role.name IN (:...roles)', { roles: filter.roles });
      }
      if (filter.statuses && filter.statuses.length > 0) {
        qb.andWhere('user.status IN (:...statuses)', {
          statuses: filter.statuses,
        });
      }
      if (filter.zaloLinkStatuses && filter.zaloLinkStatuses.length > 0) {
        qb.andWhere('user.zaloLinkStatus IN (:...zaloLinkStatuses)', {
          zaloLinkStatuses: filter.zaloLinkStatuses,
        });
      }
    }

    qb.select([
      'user.id',
      'user.username',
      'user.fullName',
      'user.nickName',
      'user.status',
      'user.employeeCode',
      'user.createdAt',
      'user.lastLogin',
      'user.email',
      'user.zaloLinkStatus',
      'user.zaloName',
      'user.avatarZalo',
      'user.zaloGender',
      'user.isBlock',
      'user.lastOnlineAt',
      'department.id',
      'department.name',
      'department.slug',
      'department.server_ip',
      'role.id',
      'role.name',
    ])
      .orderBy('user.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    const mappedData = data.map(user => ({
      ...user,
      lastOnlineAt: user.lastOnlineAt ? user.lastOnlineAt.toISOString() : null,
    }));
    return { data: mappedData, total };
  }

  async findOne(id: number): Promise<User | null> {
    if (isNaN(id) || !Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('Invalid user ID');
    }

    return this.userRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['roles', 'departments'],
    });
  }

  async findOneWithDetails(id: number): Promise<User | null> {
    if (isNaN(id) || !Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('Invalid user ID');
    }

    return this.userRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: [
        'roles',
        'roles.rolePermissions',
        'roles.rolePermissions.permission',
        'departments',
      ],
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepo.findOne({
      where: { username },
      relations: [
        'roles',
        'roles.rolePermissions',
        'roles.rolePermissions.permission',
        'departments',
      ],
      select: {
        id: true,
        username: true,
        password: true,
        roles: {
          id: true,
          name: true,
          rolePermissions: {
            id: true,
            isActive: true,
            permission: {
              id: true,
              name: true,
              action: true,
            },
          },
        },
        departments: {
          id: true,
          name: true,
          slug: true,
        },
      },
    });
  }

  async createUser(userData: CreateUserDto): Promise<User> {
    // Kiểm tra trùng username
    const existed = await this.userRepo.findOne({
      where: { username: userData.username },
    });
    if (existed) {
      if (existed.deletedAt) {
        // Trùng với user đã bị xóa mềm
        throw new ConflictException({
          message: 'Tên đăng nhập đã tồn tại nhưng đã bị xóa mềm',
          code: 'SOFT_DELETED_DUPLICATE',
          userId: existed.id,
        });
      }
      // Trùng với user đang hoạt động
      throw new ConflictException({
        message: 'Tên đăng nhập đã tồn tại',
        code: 'DUPLICATE_USERNAME',
      });
    }

    // Lấy password default từ env nếu không truyền password
    const password = process.env.PASSWORD_DEFAULT || 'default_password';
    const hashedPassword = await bcrypt.hash(password, 10);

    let roles: Role[] = [];
    if (userData.roleIds && userData.roleIds.length > 0) {
      roles = await this.roleRepo.findBy({ id: In(userData.roleIds) });
    } else {
      const userRole = await this.roleRepo.findOne({ where: { name: 'user' } });
      if (userRole) roles = [userRole];
    }

    let departments: Department[] = [];
    if (userData.departmentIds && userData.departmentIds.length > 0) {
      departments = await this.departmentRepo.findBy({
        id: In(userData.departmentIds),
      });

      // Lấy thêm role user-[slug] của từng phòng ban
      const departmentRoles = await this.roleRepo.findBy({
        name: In(departments.map((dep) => `user-${dep.slug}`)),
      });

      // Gộp roles lại (tránh trùng lặp)
      const allRoles = [...roles, ...departmentRoles];
      // Loại bỏ trùng lặp theo id
      roles = allRoles.filter(
        (role, index, self) =>
          index === self.findIndex((r) => r.id === role.id),
      );
    }

    const userObj: Partial<User> = {
      username: userData.username,
      password: hashedPassword,
      roles,
      departments,
      email: userData.email,
      status: UserStatus.INACTIVE,
      isBlock: userData.isBlock ?? false,
      employeeCode: userData.employeeCode,
      fullName: userData.fullName,
      nickName: userData.nickName,
    };

    const newUser = this.userRepo.create(userObj);
    const savedUser = await this.userRepo.save(newUser);

    return this.userRepo.findOneOrFail({
      where: { id: savedUser.id },
      relations: ['roles', 'departments'],
    });
  }

  async updateUser(
    id: number,
    updateData: UpdateUserDto,
    changerId?: number,
  ): Promise<User> {
    let status = updateData.status;

    if (typeof updateData.isBlock === 'boolean' && updateData.isBlock) {
      status = UserStatus.INACTIVE;
    }

    const oldUser = await this.userRepo.findOne({
      where: { id },
      relations: ['departments', 'roles'],
      select: {
        id: true,
        username: true,
        password: true, // Explicitly select password field
        fullName: true,
        nickName: true,
        email: true,
        status: true,
        isBlock: true,
        employeeCode: true,
        zaloLinkStatus: true,
        zaloName: true,
        avatarZalo: true,
        zaloGender: true,
        refreshToken: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        lastLogin: true,
        departments: true,
        roles: true,
      },
    });
    if (!oldUser) throw new NotFoundException('Không tìm thấy user');

    // Kiểm tra xem có thay đổi thông tin Zalo không (cần refresh token)
    const zaloInfoChanged =
      (updateData.zaloLinkStatus !== undefined &&
        updateData.zaloLinkStatus !== oldUser.zaloLinkStatus) ||
      (updateData.zaloName !== undefined &&
        updateData.zaloName !== oldUser.zaloName) ||
      (updateData.avatarZalo !== undefined &&
        updateData.avatarZalo !== oldUser.avatarZalo);

    const updatePayload: Partial<User> = {
      email: updateData.email,
      status,
      isBlock: updateData.isBlock,
      employeeCode: updateData.employeeCode,
      // Allow updating Zalo link fields
      zaloLinkStatus: updateData.zaloLinkStatus,
      zaloName: updateData.zaloName,
      avatarZalo: updateData.avatarZalo,
      zaloGender: updateData.zaloGender,
    };

    // Xử lý refresh token
    if (updateData.refreshToken !== undefined) {
      // Nếu có refreshToken trong updateData, cập nhật nó
      updatePayload.refreshToken = updateData.refreshToken;
    } else if (zaloInfoChanged) {
      // Nếu thông tin Zalo thay đổi và không có refreshToken mới, xóa refresh token để buộc user phải refresh
      updatePayload.refreshToken = undefined;
    }

    if (typeof updateData.nickName === 'string') {
      updatePayload.nickName = updateData.nickName;
    }

    if (
      typeof updateData.fullName === 'string' &&
      updateData.fullName !== oldUser.fullName
    ) {
      updatePayload.fullName = updateData.fullName;

      if (changerId) {
        let log = await this.changeUserLogRepo.findOne({
          where: { user: { id } },
          relations: ['user'],
        });
        if (!log) {
          log = this.changeUserLogRepo.create({
            user: oldUser,
            changes: [
              {
                oldFullName: oldUser.fullName || '',
                newFullName: updateData.fullName,
                timeChange: new Date().toISOString(),
                changerId,
              },
            ],
          });
        } else {
          log.changes.push({
            oldFullName: oldUser.fullName || '',
            newFullName: updateData.fullName,
            timeChange: new Date().toISOString(),
            changerId,
          });
        }
        await this.changeUserLogRepo.save(log);
      }
    }

    if (updateData.password !== undefined) {
      // Kiểm tra password không được rỗng
      if (!updateData.password || updateData.password.trim() === '') {
        throw new BadRequestException('Mật khẩu mới không được để trống');
      }

      // Không cho phép đổi mật khẩu mới trùng hoặc chứa mật khẩu mặc định
      const passwordDefault =
        process.env.PASSWORD_DEFAULT || 'default_password';
      const newPassword = updateData.password.trim();
      if (
        newPassword === passwordDefault ||
        newPassword.includes(passwordDefault)
      ) {
        throw new BadRequestException(
          'Mật khẩu mới không được trùng hoặc chứa mật khẩu mặc định',
        );
      }

      // Nếu là user tự đổi mật khẩu (changerId bằng chính id của user)
      if (changerId === id) {
        // Bắt buộc phải có currentPassword
        if (
          !updateData.currentPassword ||
          updateData.currentPassword.trim() === ''
        ) {
          throw new BadRequestException(
            'Bạn phải nhập mật khẩu hiện tại để đổi mật khẩu',
          );
        }
        // Kiểm tra user có mật khẩu hiện tại không (logic này có vấn đề vì user đã login được rồi)
        if (!oldUser.password) {
          throw new BadRequestException(
            'Lỗi hệ thống: Tài khoản không có mật khẩu nhưng đã đăng nhập được. Vui lòng liên hệ quản trị viên.',
          );
        }
        // Kiểm tra mật khẩu hiện tại có đúng không
        const isCurrentPasswordValid = await bcrypt.compare(
          updateData.currentPassword,
          oldUser.password,
        );
        if (!isCurrentPasswordValid) {
          throw new BadRequestException('Mật khẩu hiện tại không đúng');
        }
      }
      // Nếu là admin đổi cho người khác thì không cần kiểm tra currentPassword

      updatePayload.password = await bcrypt.hash(updateData.password, 10);
    }

    await this.userRepo.update(id, updatePayload);

    // Cập nhật lastLogin
    if (updateData.lastLogin) {
      await this.userRepo
        .createQueryBuilder()
        .update(User)
        .set({ lastLogin: () => 'CURRENT_TIMESTAMP' })
        .where('id = :id', { id })
        .execute();
    }

    // Cập nhật deletedAt
    if (updateData.deletedAt) {
      await this.userRepo
        .createQueryBuilder()
        .update(User)
        .set({ deletedAt: () => 'CURRENT_TIMESTAMP' })
        .where('id = :id', { id })
        .execute();
    }

    // Emit block event
    if (typeof updateData.isBlock === 'boolean') {
      // Emit to ALL users để update UI trong UserManager
      this.wsGateway.emitToAll('user_block', {
        userId: id,
        isBlock: updateData.isBlock,
      });

      // Nếu user bị block, emit riêng cho user đó để logout
      if (updateData.isBlock) {
        this.wsGateway.emitToUser(String(id), 'user_blocked', {
          userId: id,
          message: 'Tài khoản của bạn đã bị khóa',
        });
      }
    }
    // Cập nhật departments và roles phòng ban
    if (updateData.departmentIds !== undefined) {
      const newDepartments = await this.departmentRepo.findBy({
        id: In(updateData.departmentIds),
      });
      const oldDepartments = oldUser.departments ?? [];

      // Cập nhật departments (many-to-many)
      await this.userRepo
        .createQueryBuilder()
        .relation(User, 'departments')
        .of(id)
        .addAndRemove(
          newDepartments.map((d) => d.id),
          oldDepartments.map((d) => d.id),
        );

      // Cập nhật roles user-[slug] theo phòng ban mới
      let currentRoles = oldUser.roles ?? [];
      const userSlugRolePrefix = 'user-';
      // Loại bỏ các role phòng ban cũ
      currentRoles = currentRoles.filter(
        (role) =>
          !(
            role.name.startsWith(userSlugRolePrefix) &&
            oldDepartments.some((dep) => role.name === `user-${dep.slug}`)
          ),
      );

      // Thêm các role phòng ban mới
      const departmentRoles = await this.roleRepo.findBy({
        name: In(newDepartments.map((dep) => `user-${dep.slug}`)),
      });

      const allRoles = [...currentRoles, ...departmentRoles];
      const uniqueRoles = allRoles.filter(
        (role, index, self) =>
          index === self.findIndex((r) => r.id === role.id),
      );

      // Chuẩn hóa: dùng addAndRemove thay cho set để tránh lỗi TypeORM
      const oldRoleIds = (oldUser.roles ?? []).map((r) => r.id);
      const newRoleIds = uniqueRoles.map((r) => r.id);

      await this.userRepo
        .createQueryBuilder()
        .relation(User, 'roles')
        .of(id)
        .addAndRemove(newRoleIds, oldRoleIds);
    }

    // Cập nhật roles chính/phụ (nếu có)
    if (updateData.roleIds !== undefined) {
      const roles = await this.roleRepo.findBy({
        id: In(updateData.roleIds),
      });

      // Lấy lại roles hiện tại (sau khi đã cập nhật roles phòng ban ở trên)
      const userAfterDept = await this.userRepo.findOne({
        where: { id },
        relations: ['roles'],
      });
      const oldRoleIds = (userAfterDept?.roles ?? []).map((r) => r.id);
      const newRoleIds = roles.map((r) => r.id);

      await this.userRepo
        .createQueryBuilder()
        .relation(User, 'roles')
        .of(id)
        .addAndRemove(newRoleIds, oldRoleIds);
    }

    return this.userRepo.findOneOrFail({
      where: { id },
      relations: ['roles', 'departments'],
    });
  }

  async softDeleteUser(id: number): Promise<void> {
    await this.userRepo.update(id, {
      deletedAt: () => 'CURRENT_TIMESTAMP',
    });
  }

  async restoreUser(id: number): Promise<void> {
    await this.userRepo.update(id, { deletedAt: null });
  }

  async getDeletedUsers(
    page = 1,
    limit = 10,
  ): Promise<{ data: User[]; total: number }> {
    const [data, total] = await this.userRepo.findAndCount({
      withDeleted: true,
      where: { deletedAt: Not(IsNull()) },
      relations: ['roles', 'departments'],
      skip: (page - 1) * limit,
      take: limit,
      order: { deletedAt: 'DESC' },
    });
    return { data, total };
  }

  async getUsersForPermissionManagement(): Promise<User[]> {
    return this.userRepo.find({
      relations: {
        roles: true,
        departments: true,
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        departments: {
          id: true,
          name: true,
        },
        roles: {
          id: true,
          name: true,
        },
      },
      where: {
        deletedAt: IsNull(),
      },
    });
  }

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

  async findUsersByDepartmentIds(
    departmentIds: number[],
    page = 1,
    limit = 10,
    filter?: {
      search?: string;
      departments?: string[];
      roles?: string[];
      statuses?: string[];
    },
  ): Promise<{ data: User[]; total: number }> {
    const qb = this.userRepo
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.departments', 'department')
      .leftJoinAndSelect('user.roles', 'role')
      .where('user.deletedAt IS NULL')
      .andWhere('department.id IN (:...departmentIds)', { departmentIds });

    if (filter) {
      if (filter.search) {
        qb.andWhere(
          '(user.fullName LIKE :search OR user.username LIKE :search OR user.email LIKE :search)',
          { search: `%${filter.search}%` },
        );
      }
      if (filter.departments && filter.departments.length > 0) {
        qb.andWhere('department.name IN (:...departments)', {
          departments: filter.departments,
        });
      }
      if (filter.roles && filter.roles.length > 0) {
        qb.andWhere('role.name IN (:...roles)', { roles: filter.roles });
      }
      if (filter.statuses && filter.statuses.length > 0) {
        qb.andWhere('user.status IN (:...statuses)', {
          statuses: filter.statuses,
        });
      }
    }

    qb.select([
      'user.id',
      'user.username',
      'user.fullName',
      'user.nickName',
      'user.status',
      'user.employeeCode',
      'user.createdAt',
      'user.lastLogin',
      'user.email',
      'user.isBlock',
      'department.id',
      'department.name',
      'department.slug',
      'role.id',
      'role.name',
    ])
      .orderBy('user.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async getAllChangeUserLogs(options?: {
    page?: number;
    limit?: number;
    search?: string;
    departments?: string[];
  }): Promise<{ data: any[]; total: number }> {
    const page = Number(options?.page) || 1;
    const limit = Number(options?.limit) || 10;
    const skip = (page - 1) * limit;

    // 1. Lấy danh sách id đã phân trang
    let idQb = this.changeUserLogRepo.createQueryBuilder('log');
    if (options?.search) {
      idQb = idQb
        .leftJoin('log.user', 'user')
        .andWhere('user.fullName LIKE :search', {
          search: `%${options.search}%`,
        });
    }
    if (options?.departments && options.departments.length > 0) {
      idQb = idQb
        .leftJoin('log.user', 'user')
        .leftJoin('user.departments', 'department')
        .andWhere('department.name IN (:...departments)', {
          departments: options.departments,
        });
    }
    idQb.orderBy('log.id', 'DESC').skip(skip).take(limit);

    const [pagedLogs, total] = await idQb.select('log.id').getManyAndCount();
    const ids = pagedLogs.map((l) => l.id);

    if (ids.length === 0) return { data: [], total };

    // 2. Lấy đủ thông tin cho các id vừa lấy
    let logs = await this.changeUserLogRepo
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.user', 'user')
      .leftJoinAndSelect('user.departments', 'department')
      .where('log.id IN (:...ids)', { ids })
      .orderBy('log.id', 'DESC')
      .getMany();

    // Đảm bảo logs đúng thứ tự phân trang
    logs = ids
      .map((id) => logs.find((log) => log.id === id))
      .filter(Boolean) as ChangeUserLog[];

    // 3. Lấy tất cả changerIds để lấy tên người đổi
    const allChangerIds = logs.flatMap((log) =>
      log.changes.map((change) => Number(change.changerId)),
    );
    const uniqueChangerIds = Array.from(new Set(allChangerIds));
    const changers = uniqueChangerIds.length
      ? await this.userRepo.findBy({ id: In(uniqueChangerIds) })
      : [];

    const data = logs.map((log) => {
      const user = log.user;
      const department = user?.departments?.[0];
      return {
        id: log.id,
        userId: user?.id || null,
        userFullName: user?.fullName || '',
        departmentId: department?.id || null,
        departmentName: department?.name || '',
        changerFullNames: log.changes.map(
          (change) =>
            changers.find((u) => u.id === Number(change.changerId))?.fullName ||
            `ID:${change.changerId}`,
        ),
        changes: log.changes.map((change) => ({
          oldFullName: change.oldFullName,
          newFullName: change.newFullName,
          timeChange: change.timeChange,
          changerId: change.changerId,
          changerFullName:
            changers.find((u) => u.id === Number(change.changerId))?.fullName ||
            `ID:${change.changerId}`,
        })),
      };
    });

    return { data, total };
  }

  async getChangeUserLogByUser(userId: number) {
    const log = await this.changeUserLogRepo.findOne({
      where: { user: { id: userId } },
      relations: ['user', 'user.departments'],
    });
    if (!log) return null;

    const user = log.user;
    const department = user?.departments?.[0];

    const changers = await this.userRepo.findBy({
      id: In(log.changes.map((change) => Number(change.changerId))),
    });

    return {
      id: log.id,
      userId: user?.id || null,
      userFullName: user?.fullName || '',
      departmentId: department?.id || null,
      departmentName: department?.name || '',
      changerFullNames: log.changes.map(
        (change) =>
          changers.find((u) => u.id === Number(change.changerId))?.fullName ||
          `ID:${change.changerId}`,
      ),
      changes: log.changes.map((change) => ({
        oldFullName: change.oldFullName,
        newFullName: change.newFullName,
        timeChange: change.timeChange,
        changerId: change.changerId,
        changerFullName:
          changers.find((u) => u.id === Number(change.changerId))?.fullName ||
          `ID:${change.changerId}`,
      })),
    };
  }

  async updateUserRolesPermissions(
    userId: number,
    departmentIds: number[],
    roleIds: number[],
    permissionIds: number[],
    rolePermissions?: {
      roleId: number;
      permissionId: number;
      isActive: boolean;
    }[],
  ) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['departments', 'roles'],
    });
    if (!user) throw new NotFoundException('User not found');

    // Cập nhật departments (many-to-many)
    const newDepartments = await this.departmentRepo.findBy({
      id: In(departmentIds),
    });
    const oldDepartments = user.departments ?? [];
    const oldDepartmentIds = oldDepartments.map((d) => d.id);
    const newDepartmentIds = newDepartments.map((d) => d.id);

    await this.userRepo
      .createQueryBuilder()
      .relation(User, 'departments')
      .of(userId)
      .addAndRemove(newDepartmentIds, oldDepartmentIds);

    // Cập nhật roles (many-to-many)
    const newRoles = await this.roleRepo.findBy({ id: In(roleIds) });
    const oldRoles = user.roles ?? [];
    const oldRoleIds = oldRoles.map((r) => r.id);
    const newRoleIds = newRoles.map((r) => r.id);

    await this.userRepo
      .createQueryBuilder()
      .relation(User, 'roles')
      .of(userId)
      .addAndRemove(newRoleIds, oldRoleIds);

    // Nếu có rolePermissions thì gọi RolesPermissionsService.bulkUpdate
    if (rolePermissions && Array.isArray(rolePermissions)) {
      // Inject RolesPermissionsService vào service này hoặc gọi qua controller
      await this.rolesPermissionsService.bulkUpdate(rolePermissions);
    }
    this.wsGateway.emitToRoom(
      `user_${userId}`,
      'force_token_refresh',
      {
        userId,
        reason: 'permission_changed',
        message: 'Quyền của bạn đã thay đổi, vui lòng làm mới phiên đăng nhập.',
      },
    );
    return { success: true };
  }

  async updateZaloLinkStatus(userId: number, status: number): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const oldStatus = user.zaloLinkStatus;
    user.zaloLinkStatus = status;

    const updatedUser = await this.userRepo.save(user);

    // Thông báo cho observer về sự thay đổi status
    if (oldStatus !== status) {
      this.userStatusObserver.notifyUserStatusChange(
        userId,
        oldStatus,
        status,
        'webhook',
      );
    }

    return updatedUser;
  }

  async findOneWithDetailsAndRefreshToken(id: number): Promise<User | null> {
    if (isNaN(id) || !Number.isInteger(id) || id <= 0) {
      throw new BadRequestException('Invalid user ID');
    }

    return this.userRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: [
        'roles',
        'roles.rolePermissions',
        'roles.rolePermissions.permission',
        'departments',
      ],
      select: {
        id: true,
        username: true,
        email: true,
        fullName: true,
        nickName: true,
        status: true,
        isBlock: true,
        employeeCode: true,
        zaloLinkStatus: true,
        zaloName: true,
        avatarZalo: true,
        lastLogin: true,
        refreshToken: true, // Include refresh token
        roles: {
          id: true,
          name: true,
          display_name: true,
          rolePermissions: {
            id: true,
            isActive: true,
            permission: {
              id: true,
              name: true,
              action: true,
            },
          },
        },
        departments: {
          id: true,
          name: true,
          slug: true,
        },
      },
    });
  }

  async resetPasswordToDefault(id: number): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy user');

    const password = process.env.PASSWORD_DEFAULT || 'default_password';
    const hashedPassword = await bcrypt.hash(password, 10);

    await this.userRepo.update(id, { password: hashedPassword });
    return this.userRepo.findOneOrFail({ where: { id } });
  }

  async updateLastOnline(userId: number) {
    await this.userRepo.update(userId, { lastOnlineAt: new Date() });
  }
}

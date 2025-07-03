import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, Not } from 'typeorm';
import { User } from './user.entity';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from '../roles/role.entity';
import { Department } from '../departments/department.entity';
import { UserStatus } from './user-status.enum';
import { UserGateway } from './user.gateway';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    private readonly userGateway: UserGateway,
  ) {}

  async findAll(
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
      .where('user.deletedAt IS NULL');

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
    const hashedPassword = await bcrypt.hash(userData.password, 10);

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
    };

    const newUser = this.userRepo.create(userObj);
    const savedUser = await this.userRepo.save(newUser);

    return this.userRepo.findOneOrFail({
      where: { id: savedUser.id },
      relations: ['roles', 'departments'],
    });
  }

  async updateUser(id: number, updateData: UpdateUserDto): Promise<User> {
    let status = updateData.status;

    if (typeof updateData.isBlock === 'boolean') {
      if (updateData.isBlock) {
        status = UserStatus.INACTIVE;
      }
    }

    const updatePayload: Partial<User> = {
      email: updateData.email,
      status,
      isBlock: updateData.isBlock,
      employeeCode: updateData.employeeCode,
      fullName: updateData.fullName,
    };

    if (updateData.password) {
      updatePayload.password = await bcrypt.hash(updateData.password, 10);
    }

    await this.userRepo.update(id, updatePayload);

    if (updateData.lastLogin) {
      await this.userRepo
        .createQueryBuilder()
        .update(User)
        .set({ lastLogin: () => 'CURRENT_TIMESTAMP' })
        .where('id = :id', { id })
        .execute();
    }

    if (updateData.deletedAt) {
      await this.userRepo
        .createQueryBuilder()
        .update(User)
        .set({ deletedAt: () => 'CURRENT_TIMESTAMP' })
        .where('id = :id', { id })
        .execute();
    }

    if (typeof updateData.isBlock === 'boolean') {
      this.userGateway.server.to('admin_dashboard').emit('user_block', {
        userId: id,
        isBlock: updateData.isBlock,
      });
      if (updateData.isBlock) {
        this.userGateway.server.to(`user_${id}`).emit('user_block', {
          reason: 'blocked',
        });
      }
    }

    if (updateData.departmentIds !== undefined) {
      const newDepartments = await this.departmentRepo.findBy({
        id: In(updateData.departmentIds),
      });

      const user = await this.userRepo.findOne({
        where: { id },
        relations: ['departments'],
      });
      const oldDepartments = user?.departments ?? [];

      await this.userRepo
        .createQueryBuilder()
        .relation(User, 'departments')
        .of(id)
        .addAndRemove(
          newDepartments.map((d) => d.id),
          oldDepartments.map((d) => d.id),
        );
    }

    if (updateData.roleIds !== undefined) {
      const roles = await this.roleRepo.findBy({
        id: In(updateData.roleIds),
      });

      await this.userRepo
        .createQueryBuilder()
        .relation(User, 'roles')
        .of(id)
        .set(roles);
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
}

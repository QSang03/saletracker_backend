import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull } from 'typeorm';
import { User } from './user.entity';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from '../roles/role.entity';
import { Department } from '../departments/department.entity';
import { UserStatus } from './user-status.enum';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    private readonly jwtService: JwtService,
  ) {}

  async findAll(): Promise<User[]> {
    return this.userRepo.find({
      relations: ['roles', 'departments'],
      where: { deletedAt: IsNull() },
    });
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
        'departments'
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
        'departments'
      ],
      select: [
        'id',
        'username',
        'password',
        'roles',
        'departments'
      ],
    });
  }

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

    if (userData.departmentIds && userData.departmentIds.length > 0) {
      userObj.departments = await this.departmentRepo.findByIds(userData.departmentIds);
    }

    const newUser = this.userRepo.create(userObj);
    const savedUser = await this.userRepo.save(newUser);

    return this.userRepo.findOneOrFail({
      where: { id: savedUser.id },
      relations: ['roles', 'departments'],
    });
  }

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

    if (updateData.departmentIds !== undefined) {
      const departments = await this.departmentRepo.findByIds(updateData.departmentIds);
      await this.userRepo
        .createQueryBuilder()
        .relation(User, 'departments')
        .of(id)
        .set(departments);
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
      relations: ['roles', 'departments'],
    });
  }

  async softDeleteUser(id: number): Promise<void> {
    await this.userRepo.update(id, { deletedAt: new Date() });
  }

  async getUsersForPermissionManagement(): Promise<User[]> {
    return this.userRepo.find({
      relations: ['roles', 'departments'],
      select: ['id', 'username', 'departments'],
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
}

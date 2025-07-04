import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { Department } from '../departments/department.entity';
import { Permission } from '../permissions/permission.entity';
import { Role } from '../roles/role.entity';
import { User } from '../users/user.entity';
import { UserStatus } from '../users/user-status.enum';
import { RolePermission } from '../roles_permissions/roles-permissions.entity';

@Injectable()
export class SeedService implements OnModuleInit {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Department)
    private readonly departmentRepo: Repository<Department>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepo: Repository<RolePermission>,
  ) {}

  async onModuleInit() {
    const existed = await this.userRepo.findOne({
      where: { username: 'admin' },
    });
    if (existed) {
      console.log('⚠️ Seeder skipped - admin already exists.');
      return;
    }

    // 1. Tạo role admin
    const adminRole = new Role();
    adminRole.name = 'admin';
    await this.roleRepo.save(adminRole);

    // 2. Tạo user admin
    const now = new Date();
    const adminUser = new User();
    adminUser.username = 'admin';
    adminUser.fullName = 'Quản trị viên hệ thống';
    adminUser.email = 'admin@example.com';
    adminUser.status = UserStatus.ACTIVE;
    adminUser.isBlock = false;
    adminUser.employeeCode = 'EMP-ADMIN';
    adminUser.password = await bcrypt.hash('admin', 10);
    adminUser.roles = [adminRole];
    adminUser.departments = [];
    adminUser.lastLogin = now;

    await this.userRepo.save(adminUser);

    console.log('✅ Seeder: Đã tạo user admin thành công!');
    console.log('👉 Tài khoản test: admin / admin');
  }
}
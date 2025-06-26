import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { Department } from 'src/departments/department.entity';
import { Permission } from 'src/permissions/permission.entity';
import { Role } from 'src/roles/role.entity';
import { User } from 'src/users/user.entity';

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
  ) {}

  async onModuleInit() {
    const existed = await this.userRepo.findOne({ where: { username: 'admin' } });
    if (existed) {
      console.log('⚠️ Seeder skipped - admin already exists.');
      return;
    }

    // 1. Departments
    const [depKD, depCN, depPM] = await this.departmentRepo.save([
      { name: 'Kinh doanh' },
      { name: 'Công nợ' },
      { name: 'Product Management' },
    ]);

    // 2. Permissions
    const actions = ['create', 'read', 'update', 'delete', 'import', 'export'];
    const permissions = await this.permissionRepo.save(
      actions.map(action => ({ action }))
    );

    // 3. Roles (gán permission cho manager, user)
    const managerRole = this.roleRepo.create({
      name: 'manager',
      permissions,
    });

    const readPermission = permissions.find(p => p.action === 'read');
    const userRole = this.roleRepo.create({
      name: 'user',
      permissions: readPermission ? [readPermission] : [],
    });

    await this.roleRepo.save([managerRole, userRole]);

    // 4. Admin user — không gán role
    const admin = this.userRepo.create({
      username: 'admin',
      password: bcrypt.hashSync('admin', 10),
      roles: [],
    });

    await this.userRepo.save(admin);

    console.log('✅ Seeder: Đã tạo department, permission, role (manager, user), user admin (không role)');
  }
}

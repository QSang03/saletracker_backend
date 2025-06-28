import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { Department } from '../departments/department.entity';
import { Permission } from '../permissions/permission.entity';
import { Role } from '../roles/role.entity';
import { User } from '../users/user.entity';
import { UserStatus } from '../users/user-status.enum'; // Import enum trạng thái

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

    // 1. Tạo departments
    const departments = await this.departmentRepo.save([
      { name: 'Kinh doanh' },
      { name: 'Công nợ' },
      { name: 'Product Management' },
    ]);
    const depKD = departments.find(d => d.name === 'Kinh doanh');
    const depCN = departments.find(d => d.name === 'Công nợ');

    // 2. Tạo permissions
    const permissions = await this.permissionRepo.save([
      { action: 'create' },
      { action: 'read' },
      { action: 'update' },
      { action: 'delete' },
      { action: 'import' },
      { action: 'export' },
    ]);

    // 3. Tạo roles và gán permissions
    const adminRole = new Role();
    adminRole.name = 'admin';
    adminRole.permissions = permissions;

    const managerRole = new Role();
    managerRole.name = 'manager';
    managerRole.permissions = permissions.filter(p =>
      ['read', 'update', 'export'].includes(p.action)
    );

    const userRole = new Role();
    userRole.name = 'user';
    userRole.permissions = permissions.filter(p => p.action === 'read');

    await this.roleRepo.save([adminRole, managerRole, userRole]);

    // 4. Tạo users với đầy đủ thông tin
    const adminUser = new User();
    adminUser.username = 'admin';
    adminUser.fullName = 'Quản trị viên hệ thống';
    adminUser.email = 'admin@example.com';
    adminUser.phone = '0912345678';
    adminUser.avatar = 'https://i.pravatar.cc/150?img=1';
    adminUser.status = UserStatus.ACTIVE;
    adminUser.password = await bcrypt.hash('admin', 10);
    adminUser.roles = [adminRole];
    adminUser.lastLogin = new Date();
    adminUser.createdAt = new Date();
    adminUser.updatedAt = new Date();

    const managerUser = new User();
    managerUser.username = 'manager_kd';
    managerUser.fullName = 'Nguyễn Văn Quản Lý';
    managerUser.email = 'manager_kd@example.com';
    managerUser.phone = '0987654321';
    managerUser.avatar = 'https://i.pravatar.cc/150?img=2';
    managerUser.status = UserStatus.ACTIVE;
    managerUser.password = await bcrypt.hash('managerpass', 10);
    managerUser.department = depKD;
    managerUser.roles = [managerRole];
    managerUser.lastLogin = new Date();
    managerUser.createdAt = new Date();
    managerUser.updatedAt = new Date();

    const normalUser = new User();
    normalUser.username = 'user_kd';
    normalUser.fullName = 'Trần Thị Nhân Viên';
    normalUser.email = 'user_kd@example.com';
    normalUser.phone = '0978123456';
    normalUser.avatar = 'https://i.pravatar.cc/150?img=3';
    normalUser.status = UserStatus.ACTIVE;
    normalUser.password = await bcrypt.hash('userpass', 10);
    normalUser.department = depKD;
    normalUser.roles = [userRole];
    normalUser.lastLogin = new Date();
    normalUser.createdAt = new Date();
    normalUser.updatedAt = new Date();

    // Có thể thêm 1 user ở phòng ban khác để test
    const cnUser = new User();
    cnUser.username = 'user_cn';
    cnUser.fullName = 'Lê Công Nợ';
    cnUser.email = 'user_cn@example.com';
    cnUser.phone = '0966998877';
    cnUser.avatar = 'https://i.pravatar.cc/150?img=4';
    cnUser.status = UserStatus.INACTIVE;
    cnUser.password = await bcrypt.hash('userpass', 10);
    cnUser.department = depCN;
    cnUser.roles = [userRole];
    cnUser.lastLogin = new Date();
    cnUser.createdAt = new Date();
    cnUser.updatedAt = new Date();

    // Lưu users
    await this.userRepo.save([adminUser, managerUser, normalUser, cnUser]);

    console.log('✅ Seeder: Đã tạo dữ liệu mẫu thành công!');
    console.log('👉 Tài khoản test:');
    console.log('   - admin (full quyền)');
    console.log('   - manager_kd (Kinh doanh, quyền manager)');
    console.log('   - user_kd (Kinh doanh, quyền user)');
    console.log('   - user_cn (Công nợ, quyền user, trạng thái INACTIVE)');
  }
}

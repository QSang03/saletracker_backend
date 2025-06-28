import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { Department } from '../departments/department.entity';
import { Permission } from '../permissions/permission.entity';
import { Role } from '../roles/role.entity';
import { User } from '../users/user.entity';
import { UserStatus } from '../users/user-status.enum';
import { RolePermission } from '../roles_permissions/roles_permissions.entity';

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
    
    // Đảm bảo tìm thấy department bằng cách sử dụng filter
    const depKD = departments.find(d => d.name === 'Kinh doanh');
    const depCN = departments.find(d => d.name === 'Công nợ');

    // Kiểm tra và xử lý nếu không tìm thấy department
    if (!depKD || !depCN) {
      throw new Error('Required departments not found in seed data');
    }

    // 2. Tạo permissions
    const permissions = await this.permissionRepo.save([
      { action: 'create' },
      { action: 'read' },
      { action: 'update' },
      { action: 'delete' },
      { action: 'import' },
      { action: 'export' },
    ]);

    // 3. Tạo roles
    const adminRole = new Role();
    adminRole.name = 'admin';
    await this.roleRepo.save(adminRole);

    const managerRole = new Role();
    managerRole.name = 'manager';
    await this.roleRepo.save(managerRole);

    const userRole = new Role();
    userRole.name = 'user';
    await this.roleRepo.save(userRole);

    // 4. Tạo RolePermissions
    // Admin: toàn quyền, isActive = true
    const adminPermissions = permissions.map(permission => {
      const rp = new RolePermission();
      rp.role = adminRole;
      rp.permission = permission;
      rp.isActive = true;
      return rp;
    });
    await this.rolePermissionRepo.save(adminPermissions);

    // Manager: toàn quyền nhưng có thể bật/tắt bằng is_active
    const managerPermissions = permissions.map(permission => {
      const rp = new RolePermission();
      rp.role = managerRole;
      rp.permission = permission;
      rp.isActive = true; // Mặc định bật tất cả
      return rp;
    });
    await this.rolePermissionRepo.save(managerPermissions);

    // User: toàn quyền nhưng có thể bật/tắt bằng is_active
    const userPermissions = permissions.map(permission => {
      const rp = new RolePermission();
      rp.role = userRole;
      rp.permission = permission;
      rp.isActive = true; // Mặc định bật tất cả
      return rp;
    });
    await this.rolePermissionRepo.save(userPermissions);

    // 5. Tạo users
    // Admin: không có nhóm, toàn quyền
    const adminUser = new User();
    adminUser.username = 'admin';
    adminUser.fullName = 'Quản trị viên hệ thống';
    adminUser.email = 'admin@example.com';
    adminUser.phone = '0912345678';
    adminUser.avatar = 'https://i.pravatar.cc/150?img=1';
    adminUser.status = UserStatus.ACTIVE;
    adminUser.password = await bcrypt.hash('admin', 10);
    adminUser.roles = [adminRole];
    adminUser.departments = []; // Không có nhóm
    adminUser.lastLogin = new Date();
    adminUser.createdAt = new Date();
    adminUser.updatedAt = new Date();

    // Manager: có nhóm và toàn quyền (có thể bật/tắt bằng is_active)
    const managerUser = new User();
    managerUser.username = 'manager_kd';
    managerUser.fullName = 'Nguyễn Văn Quản Lý';
    managerUser.email = 'manager_kd@example.com';
    managerUser.phone = '0987654321';
    managerUser.avatar = 'https://i.pravatar.cc/150?img=2';
    managerUser.status = UserStatus.ACTIVE;
    managerUser.password = await bcrypt.hash('managerpass', 10);
    managerUser.roles = [managerRole];
    managerUser.departments = [depKD]; // Có nhóm
    managerUser.lastLogin = new Date();
    managerUser.createdAt = new Date();
    managerUser.updatedAt = new Date();

    // User: có nhóm và toàn quyền (có thể bật/tắt bằng is_active)
    const normalUser = new User();
    normalUser.username = 'user_kd';
    normalUser.fullName = 'Trần Thị Nhân Viên';
    normalUser.email = 'user_kd@example.com';
    normalUser.phone = '0978123456';
    normalUser.avatar = 'https://i.pravatar.cc/150?img=3';
    normalUser.status = UserStatus.ACTIVE;
    normalUser.password = await bcrypt.hash('userpass', 10);
    normalUser.roles = [userRole];
    normalUser.departments = [depKD]; // Có nhóm
    normalUser.lastLogin = new Date();
    normalUser.createdAt = new Date();
    normalUser.updatedAt = new Date();

    // User khác: có nhóm khác
    const cnUser = new User();
    cnUser.username = 'user_cn';
    cnUser.fullName = 'Lê Công Nợ';
    cnUser.email = 'user_cn@example.com';
    cnUser.phone = '0966998877';
    cnUser.avatar = 'https://i.pravatar.cc/150?img=4';
    cnUser.status = UserStatus.INACTIVE;
    cnUser.password = await bcrypt.hash('userpass', 10);
    cnUser.roles = [userRole];
    cnUser.departments = [depCN]; // Có nhóm khác
    cnUser.lastLogin = new Date();
    cnUser.createdAt = new Date();
    cnUser.updatedAt = new Date();

    await this.userRepo.save([adminUser, managerUser, normalUser, cnUser]);

    console.log('✅ Seeder: Đã tạo dữ liệu mẫu thành công!');
    console.log('👉 Tài khoản test:');
    console.log('   - admin (full quyền, không nhóm)');
    console.log('   - manager_kd (Kinh doanh, quyền manager - toàn quyền)');
    console.log('   - user_kd (Kinh doanh, quyền user - toàn quyền)');
    console.log('   - user_cn (Công nợ, quyền user - toàn quyền, trạng thái INACTIVE)');
  }
}

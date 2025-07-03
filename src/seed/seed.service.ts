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

    // 1. Tạo departments (KHÔNG tạo Product Management ở đây)
    const departments = await this.departmentRepo.save([
      { name: 'Kinh doanh', slug: 'kinh-doanh' },
      { name: 'Công nợ', slug: 'cong-no' },
    ]);

    // Đảm bảo tìm thấy department bằng cách sử dụng filter
    const depKD = departments.find((d) => d.name === 'Kinh doanh');
    const depCN = departments.find((d) => d.name === 'Công nợ');

    if (!depKD || !depCN) {
      throw new Error('Required departments not found in seed data');
    }

    // 2. Tạo permissions cho từng phòng ban
    const actions = ['create', 'read', 'update', 'delete', 'import', 'export'];
    const permissions: Permission[] = [];
    for (const dep of [depKD, depCN]) {
      for (const action of actions) {
        permissions.push(
          this.permissionRepo.create({ name: dep.slug, action })
        );
      }
    }
    await this.permissionRepo.save(permissions);

    // 3. Tạo roles (Product Management là role, không phải department)
    const adminRole = new Role();
    adminRole.name = 'admin';
    await this.roleRepo.save(adminRole);

    const managerRole = new Role();
    managerRole.name = 'manager';
    await this.roleRepo.save(managerRole);

    const userRole = new Role();
    userRole.name = 'user';
    await this.roleRepo.save(userRole);

    const productManagerRole = new Role();
    productManagerRole.name = 'product-manager';
    await this.roleRepo.save(productManagerRole);

    // 4. Tạo RolePermissions
    // Admin: toàn quyền, isActive = true
    const adminPermissions = permissions.map((permission) => {
      const rp = new RolePermission();
      rp.role = adminRole;
      rp.permission = permission;
      rp.isActive = true;
      return rp;
    });
    await this.rolePermissionRepo.save(adminPermissions);

    // Manager: toàn quyền nhưng có thể bật/tắt bằng is_active
    const managerPermissions = permissions.map((permission) => {
      const rp = new RolePermission();
      rp.role = managerRole;
      rp.permission = permission;
      rp.isActive = true;
      return rp;
    });
    await this.rolePermissionRepo.save(managerPermissions);

    // User: toàn quyền nhưng có thể bật/tắt bằng is_active
    const userPermissions = permissions.map((permission) => {
      const rp = new RolePermission();
      rp.role = userRole;
      rp.permission = permission;
      rp.isActive = true;
      return rp;
    });
    await this.rolePermissionRepo.save(userPermissions);

    // Product Manager: chưa gán permission nào (tùy bạn muốn gán gì thì thêm vào)

    // 5. Tạo users
    // Để các trường ngày giờ là Date, để DB tự động xử lý đúng timezone
    // Không dùng formatToVietnamDatetime ở đây!
    const now = new Date();

    // Admin: không có nhóm, toàn quyền
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
    // createdAt, updatedAt sẽ để DB tự động set

    // Manager: username là số điện thoại
    const managerUser = new User();
    managerUser.username = '0987654321';
    managerUser.fullName = 'Nguyễn Văn Quản Lý';
    managerUser.email = 'manager_kd@example.com';
    managerUser.status = UserStatus.ACTIVE;
    managerUser.isBlock = false;
    managerUser.employeeCode = 'EMP-MANAGER';
    managerUser.password = await bcrypt.hash('managerpass', 10);
    managerUser.roles = [managerRole];
    managerUser.departments = [depKD];
    managerUser.lastLogin = now;

    // User: username là số điện thoại
    const normalUser = new User();
    normalUser.username = '0978123456';
    normalUser.fullName = 'Trần Thị Nhân Viên';
    normalUser.email = 'user_kd@example.com';
    normalUser.status = UserStatus.ACTIVE;
    normalUser.isBlock = false;
    normalUser.employeeCode = 'EMP-USER1';
    normalUser.password = await bcrypt.hash('userpass', 10);
    normalUser.roles = [userRole];
    normalUser.departments = [depKD];
    normalUser.lastLogin = now;

    // User khác: username là số điện thoại, bị khóa
    const cnUser = new User();
    cnUser.username = '0966998877';
    cnUser.fullName = 'Lê Công Nợ';
    cnUser.email = 'user_cn@example.com';
    cnUser.status = UserStatus.INACTIVE;
    cnUser.isBlock = true;
    cnUser.employeeCode = 'EMP-USER2';
    cnUser.password = await bcrypt.hash('userpass', 10);
    cnUser.roles = [userRole];
    cnUser.departments = [depCN];
    cnUser.lastLogin = now;

    await this.userRepo.save([adminUser, managerUser, normalUser, cnUser]);

    console.log('✅ Seeder: Đã tạo dữ liệu mẫu thành công!');
    console.log('👉 Tài khoản test:');
    console.log('   - admin (full quyền, không nhóm)');
    console.log('   - manager_kd (Kinh doanh, quyền manager - toàn quyền)');
    console.log('   - user_kd (Kinh doanh, quyền user - toàn quyền)');
    console.log(
      '   - user_cn (Công nợ, quyền user - toàn quyền, trạng thái INACTIVE)',
    );
  }
}
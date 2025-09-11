import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from './permission.entity';
import { PermissionService } from './permission.service';
import { PermissionController } from './permission.controller';
import { AuthModule } from '../auth/auth.module';
import { Role } from '../roles/role.entity';
import { RolePermission } from '../roles_permissions/roles-permissions.entity';
import { Brand } from '../brands/brand.entity';
import { Category } from '../categories/category.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Permission, Role, RolePermission, Brand, Category]),
    forwardRef(() => AuthModule),
  ],
  providers: [PermissionService],
  controllers: [PermissionController],
  exports: [PermissionService, TypeOrmModule],
})
export class PermissionModule {}

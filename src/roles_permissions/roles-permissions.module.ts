import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RolesPermissionsService } from './roles-permissions.service';
import { RolePermission } from './roles-permissions.entity';
import { RolesPermissionsController } from './roles-permissions.controller';
import { UserModule } from '../users/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RolePermission]),
    forwardRef(() => UserModule), // Đảm bảo inject UserService cho JwtAuthGuard
  ],
  providers: [RolesPermissionsService],
  controllers: [RolesPermissionsController],
  exports: [RolesPermissionsService],
})
export class RolesPermissionsModule {}

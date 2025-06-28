import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from './role.entity';
import { RoleService } from './role.service';
import { RoleController } from './role.controller';
import { AuthModule } from '../auth/auth.module';
import { PermissionModule } from '../permissions/permission.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Role]),
    forwardRef(() => AuthModule),
    forwardRef(() => PermissionModule),
  ],
  providers: [RoleService],
  controllers: [RoleController],
  exports: [RoleService],
})
export class RoleModule {}

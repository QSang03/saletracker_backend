import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Department } from './department.entity';
import { DepartmentService } from './department.service';
import { DepartmentController } from './department.controller';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../users/user.module';
import { PermissionModule } from 'src/permissions/permission.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Department]),
    forwardRef(() => AuthModule),
    forwardRef(() => UserModule),
    forwardRef(() => PermissionModule),
  ],
  providers: [DepartmentService],
  controllers: [DepartmentController],
  exports: [DepartmentService],
})
export class DepartmentModule {}

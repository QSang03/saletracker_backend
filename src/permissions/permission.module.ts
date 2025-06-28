import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from './permission.entity';
import { PermissionService } from './permission.service';
import { PermissionController } from './permission.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Permission]),
    forwardRef(() => AuthModule),
  ],
  providers: [PermissionService],
  controllers: [PermissionController],
  exports: [PermissionService, TypeOrmModule],
})
export class PermissionModule {}

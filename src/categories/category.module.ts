import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './category.entity';
import { CategoryService } from '../categories/category.service';
import { CategoryController } from '../categories/category.controller';
import { CategorySubscriber } from './category.subscriber';
import { PermissionModule } from '../permissions/permission.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Category]), PermissionModule, AuthModule],
  providers: [CategoryService, CategorySubscriber],
  controllers: [CategoryController],
  exports: [CategoryService],
})
export class CategoryModule {}

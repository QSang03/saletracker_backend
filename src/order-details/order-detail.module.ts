import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderDetail } from './order-detail.entity';
import { OrderDetailService } from './order-detail.service';
import { OrderDetailController } from './order-detail.controller';
import { Department } from 'src/departments/department.entity';
import { User } from 'src/users/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OrderDetail, Department, User])],
  providers: [OrderDetailService],
  controllers: [OrderDetailController],
  exports: [OrderDetailService],
})
export class OrderDetailModule {}

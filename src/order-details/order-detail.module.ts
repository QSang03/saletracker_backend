import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderDetail } from './order-detail.entity';
import { OrderDetailService } from './order-detail.service';
import { OrderDetailController } from './order-detail.controller';
import { TransactionStatsService } from './transaction-stats.service';
import { Department } from 'src/departments/department.entity';
import { User } from 'src/users/user.entity';
import { OrderBlacklistModule } from '../order-blacklist/order-blacklist.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderDetail, Department, User]),
    OrderBlacklistModule,
  ],
  providers: [OrderDetailService, TransactionStatsService],
  controllers: [OrderDetailController],
  exports: [OrderDetailService, TransactionStatsService],
})
export class OrderDetailModule {}

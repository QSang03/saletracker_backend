import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderBlacklistService } from './order-blacklist.service';
import { OrderBlacklistController } from './order-blacklist.controller';
import { OrderBlacklist } from './order-blacklist.entity';
import { OrderDetail } from '../order-details/order-detail.entity';
import { User } from '../users/user.entity';
import { Department } from '../departments/department.entity';

@Module({
  imports: [TypeOrmModule.forFeature([OrderBlacklist, OrderDetail, User, Department])],
  controllers: [OrderBlacklistController],
  providers: [OrderBlacklistService],
  exports: [OrderBlacklistService],
})
export class OrderBlacklistModule {}

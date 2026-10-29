import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderDetail } from './order-detail.entity';
import { OrderDetailService } from './order-detail.service';
import { OrderDetailController } from './order-detail.controller';
import { TransactionStatsService } from './transaction-stats.service';
import { OrderStatusContextService } from './order-status-context.service';
import { Department } from 'src/departments/department.entity';
import { User } from 'src/users/user.entity';
import { Brand } from 'src/brands/brand.entity';
import { Category } from 'src/categories/category.entity';
import { OrderBlacklistModule } from '../order-blacklist/order-blacklist.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderDetail, Department, User, Brand, Category]),
    OrderBlacklistModule,
  ],
  providers: [
    OrderDetailService,
    TransactionStatsService,
    OrderStatusContextService,
  ],
  controllers: [OrderDetailController],
  exports: [
    OrderDetailService,
    TransactionStatsService,
    OrderStatusContextService,
  ],
})
export class OrderDetailModule {}

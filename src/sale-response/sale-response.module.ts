import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SaleResponseService } from './sale-response.service';
import { SaleResponseController } from './sale-response.controller';
import { SaleResponseInterval } from './sale-response-interval.entity';
import { SaleResponseDaily } from './sale-response-daily.entity';
import { SaleWorkActivityDaily } from './sale-work-activity-daily.entity';
import { OrderModule } from '../orders/order.module';
import { OrderBlacklistModule } from '../order-blacklist/order-blacklist.module';
import { User } from '../users/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SaleResponseInterval,
      SaleResponseDaily,
      SaleWorkActivityDaily,
      User,
    ]),
    // OrderModule xuất OrderService để dùng chung luật phân quyền xem theo role
    OrderModule,
    // Dùng chung bảng order_blacklist với trang quản lý blacklist
    OrderBlacklistModule,
  ],
  controllers: [SaleResponseController],
  providers: [SaleResponseService],
  exports: [SaleResponseService],
})
export class SaleResponseModule {}
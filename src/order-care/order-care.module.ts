import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderDetail } from '../order-details/order-detail.entity';
import { OrderDetailModule } from '../order-details/order-detail.module';
import { OrderModule } from '../orders/order.module';
import { OrderBlacklistModule } from '../order-blacklist/order-blacklist.module';
import { ZaloPythonApiClient } from '../customer-kpi/zalo-python-api.client';
import { OrderCareBatch } from './entities/order-care-batch.entity';
import { OrderCareItem } from './entities/order-care-item.entity';
import { OrderStatusHistory } from './entities/order-status-history.entity';
import { OrderCareService } from './order-care.service';
import { OrderCareStatsService } from './order-care-stats.service';
import { OrderCareController } from './order-care.controller';
import { OrderProjectController } from './order-project.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderDetail,
      OrderCareBatch,
      OrderCareItem,
      OrderStatusHistory,
    ]),
    OrderModule,
    OrderDetailModule,
    OrderBlacklistModule,
  ],
  controllers: [OrderCareController, OrderProjectController],
  providers: [OrderCareService, OrderCareStatsService, ZaloPythonApiClient],
  exports: [OrderCareService],
})
export class OrderCareModule {}

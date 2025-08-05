import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './order.entity';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { OrderDetail } from 'src/order-details/order-detail.entity';
import { Department } from 'src/departments/department.entity';
import { User } from 'src/users/user.entity';
import { Product } from 'src/products/product.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderDetail, Department, User, Product])],
  providers: [OrderService],
  controllers: [OrderController],
  exports: [OrderService],
})
export class OrderModule {}

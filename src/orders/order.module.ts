import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './order.entity';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { OrderDetail } from 'src/order-details/order-detail.entity';
import { Department } from 'src/departments/department.entity';
import { User } from 'src/users/user.entity';
import { Product } from 'src/products/product.entity';
import { Brand } from 'src/brands/brand.entity';
import { Category } from 'src/categories/category.entity';
import { OrderBlacklistModule } from '../order-blacklist/order-blacklist.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderDetail, Department, User, Product, Brand, Category]),
    OrderBlacklistModule,
  ],
  providers: [OrderService],
  controllers: [OrderController],
  exports: [OrderService],
})
export class OrderModule {}

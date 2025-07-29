import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { Order } from './order.entity';
import { OrderDetail } from 'src/order-details/order-detail.entity';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  async findAll(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '10',
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('date') date?: string,
    @Query('employee') employee?: string,
  ): Promise<{
    data: OrderDetail[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    // Thay đổi từ Order[] thành OrderDetail[]
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(
      100,
      Math.max(1, parseInt(pageSize, 10) || 10),
    );

    return this.orderService.findAllPaginated({
      page: pageNum,
      pageSize: pageSizeNum,
      search: search?.trim(),
      status,
      date,
      employee,
    });
  }

  @Get(':id')
  async findById(@Param('id', ParseIntPipe) id: number): Promise<Order | null> {
    return this.orderService.findById(id);
  }

  @Post()
  async create(@Body() orderData: Partial<Order>): Promise<Order> {
    return this.orderService.create(orderData);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() orderData: Partial<Order>,
  ): Promise<Order | null> {
    return this.orderService.update(id, orderData);
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.orderService.delete(id);
  }
}

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
} from '@nestjs/common';
import { OrderDetailService } from './order-detail.service';
import { OrderDetail } from './order-detail.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Controller('order-details')
export class OrderDetailController {
  constructor(
    private readonly orderDetailService: OrderDetailService,
  ) {}

  @Get()
  async findAll(): Promise<OrderDetail[]> {
    return this.orderDetailService.findAll();
  }

  @Get(':id')
  async findById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OrderDetail | null> {
    return this.orderDetailService.findById(id);
  }

  @Get('order/:orderId')
  async findByOrderId(
    @Param('orderId', ParseIntPipe) orderId: number,
  ): Promise<OrderDetail[]> {
    return this.orderDetailService.findByOrderId(orderId);
  }

  @Post()
  async create(
    @Body() orderDetailData: Partial<OrderDetail>,
  ): Promise<OrderDetail> {
    return this.orderDetailService.create(orderDetailData);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() orderDetailData: Partial<OrderDetail>,
  ): Promise<OrderDetail | null> {
    return this.orderDetailService.update(id, orderDetailData);
  }

  @Delete(':id')
  async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.orderDetailService.delete(id);
  }

  @Delete('order/:orderId')
  async deleteByOrderId(
    @Param('orderId', ParseIntPipe) orderId: number,
  ): Promise<void> {
    return this.orderDetailService.deleteByOrderId(orderId);
  }

}

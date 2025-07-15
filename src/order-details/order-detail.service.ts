import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderDetail } from './order-detail.entity';

@Injectable()
export class OrderDetailService {
  constructor(
    @InjectRepository(OrderDetail)
    private orderDetailRepository: Repository<OrderDetail>,
  ) {}

  async findAll(): Promise<OrderDetail[]> {
    return this.orderDetailRepository.find({
      relations: ['order', 'product'],
    });
  }

  async findById(id: number): Promise<OrderDetail | null> {
    return this.orderDetailRepository.findOne({
      where: { id },
      relations: ['order', 'product'],
    });
  }

  async findByOrderId(orderId: number): Promise<OrderDetail[]> {
    return this.orderDetailRepository.find({
      where: { order_id: orderId },
      relations: ['product'],
    });
  }

  async create(orderDetailData: Partial<OrderDetail>): Promise<OrderDetail> {
    const orderDetail = this.orderDetailRepository.create(orderDetailData);
    return this.orderDetailRepository.save(orderDetail);
  }

  async update(
    id: number,
    orderDetailData: Partial<OrderDetail>,
  ): Promise<OrderDetail | null> {
    await this.orderDetailRepository.update(id, orderDetailData);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    await this.orderDetailRepository.softDelete(id);
  }

  async deleteByOrderId(orderId: number): Promise<void> {
    await this.orderDetailRepository.softDelete({ order_id: orderId });
  }
}

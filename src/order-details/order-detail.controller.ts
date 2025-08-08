import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  UseGuards,
  Req,
  NotFoundException,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrderDetailService } from './order-detail.service';
import { OrderDetail } from './order-detail.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderBlacklistService } from '../order-blacklist/order-blacklist.service';

@Controller('order-details')
@UseGuards(AuthGuard('jwt'))
export class OrderDetailController {
  constructor(
    private readonly orderDetailService: OrderDetailService,
    private readonly orderBlacklistService: OrderBlacklistService,
  ) {}

  @Get()
  async findAll(@Req() req?: any): Promise<OrderDetail[]> {
    return this.orderDetailService.findAllWithPermission(req.user);
  }

  @Get(':id')
  async findById(
    @Param('id', ParseIntPipe) id: number,
    @Req() req?: any,
  ): Promise<OrderDetail | null> {
    return this.orderDetailService.findByIdWithPermission(id, req.user);
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
    @Req() req?: any,
  ): Promise<OrderDetail | null> {
    // Kiểm tra quyền trước khi update
    const existingOrderDetail = await this.orderDetailService.findByIdWithPermission(id, req.user);
    if (!existingOrderDetail) {
      return null; // Không có quyền hoặc không tồn tại
    }
    
    return this.orderDetailService.update(id, orderDetailData);
  }

  @Delete(':id')
  async delete(
    @Param('id', ParseIntPipe) id: number,
    @Req() req?: any,
  ): Promise<void> {
    // Kiểm tra quyền trước khi delete
    const existingOrderDetail = await this.orderDetailService.findByIdWithPermission(id, req.user);
    if (!existingOrderDetail) {
      throw new ForbiddenException('Không có quyền xóa hoặc order detail không tồn tại');
    }
    
    return this.orderDetailService.delete(id);
  }

  @Delete('order/:orderId')
  async deleteByOrderId(
    @Param('orderId', ParseIntPipe) orderId: number,
  ): Promise<void> {
    return this.orderDetailService.deleteByOrderId(orderId);
  }

  // ✅ Bulk operations
  @Post('bulk-delete')
  async bulkDelete(
    @Body() data: { ids: number[], reason: string },
    @Req() req?: any,
  ): Promise<{ deleted: number }> {
    return this.orderDetailService.bulkDelete(data.ids, data.reason, req.user);
  }

  @Post('bulk-update')
  async bulkUpdate(
    @Body() data: { ids: number[], updates: Partial<OrderDetail> },
    @Req() req?: any,
  ): Promise<{ updated: number }> {
    return this.orderDetailService.bulkUpdate(data.ids, data.updates, req.user);
  }

  @Post('bulk-extend')
  async bulkExtend(
    @Body() data: { ids: number[] },
    @Req() req?: any,
  ): Promise<{ updated: number }> {
    return this.orderDetailService.bulkExtend(data.ids, req.user);
  }

  @Post('bulk-notes')
  async bulkAddNotes(
    @Body() data: { ids: number[], notes: string },
    @Req() req?: any,
  ): Promise<{ updated: number }> {
    return this.orderDetailService.bulkAddNotes(data.ids, data.notes, req.user);
  }

  @Put(':id/customer-name')
  async updateCustomerName(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { customer_name: string },
    @Req() req?: any,
  ): Promise<OrderDetail | null> {
    // Kiểm tra quyền trước khi update
    const existingOrderDetail = await this.orderDetailService.findByIdWithPermission(id, req.user);
    if (!existingOrderDetail) {
      return null; // Không có quyền hoặc không tồn tại
    }
    
    return this.orderDetailService.updateCustomerName(id, data.customer_name);
  }

  @Post(':id/add-to-blacklist')
  @HttpCode(HttpStatus.CREATED)
  async addToBlacklist(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { reason?: string },
    @Req() req?: any,
  ): Promise<{ message: string; blacklistEntry?: any }> {
    // Lấy order detail và kiểm tra quyền
    const orderDetail = await this.orderDetailService.findByIdWithPermission(id, req.user);
    if (!orderDetail) {
      throw new NotFoundException('Order detail not found or no permission');
    }

    // Parse customer_id từ metadata
    let customerId: string | null = null;
    try {
      if (typeof orderDetail.metadata === 'string') {
        const parsed = JSON.parse(orderDetail.metadata);
        customerId = parsed.customer_id || null;
      } else if (typeof orderDetail.metadata === 'object' && orderDetail.metadata !== null) {
        customerId = orderDetail.metadata.customer_id || null;
      }
    } catch (error) {
      // Ignore parse errors
    }

    if (!customerId) {
      throw new ForbiddenException('No customer_id found in order detail metadata');
    }

    // Kiểm tra xem đã có trong blacklist chưa
    const isAlreadyBlacklisted = await this.orderBlacklistService.isBlacklisted(req.user.id, customerId);
    if (isAlreadyBlacklisted) {
      return { message: 'Contact is already in blacklist' };
    }

    // Thêm vào blacklist
    const blacklistEntry = await this.orderBlacklistService.create({
      userId: req.user.id,
      zaloContactId: customerId,
      reason: data.reason || `Added from order detail #${id}`,
    });

    return { 
      message: 'Contact added to blacklist successfully',
      blacklistEntry 
    };
  }

}

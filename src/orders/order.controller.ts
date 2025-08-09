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
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrderService } from './order.service';
import { Order } from './order.entity';
import { OrderDetail } from 'src/order-details/order-detail.entity';

@Controller('orders')
@UseGuards(AuthGuard('jwt'))
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  async findAll(
    @Query('page') page: string = '1',
    @Query('pageSize') pageSize: string = '10',
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('date') date?: string,
    @Query('dateRange') dateRange?: string,
    @Query('employee') employee?: string,
    @Query('employees') employees?: string,
    @Query('departments') departments?: string,
    @Query('products') products?: string,
    @Query('warningLevel') warningLevel?: string,
    @Query('sortField') sortField?: 'quantity' | 'unit_price',
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
    @Req() req?: any,
  ): Promise<{
    data: OrderDetail[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(
      10000,
      Math.max(1, parseInt(pageSize, 10) || 10),
    );
    
    // Parse dateRange if provided
    let parsedDateRange;
    if (dateRange) {
      try {
        parsedDateRange = JSON.parse(dateRange);
      } catch (e) {
        parsedDateRange = undefined;
      }
    }
    
    // Truyền cả user xuống service để phân quyền
    return this.orderService.findAllPaginated({
      page: pageNum,
      pageSize: pageSizeNum,
      search: search?.trim(),
      status,
      date,
      dateRange: parsedDateRange,
      employee,
      employees,
      departments,
      products,
      warningLevel,
      sortField: sortField || null,
      sortDirection: sortDirection || null,
      user: req.user,
    });
  }

  @Get('all')
  async findAllWithPermission(@Req() req?: any): Promise<Order[]> {
    return this.orderService.findAllWithPermission(req.user);
  }

  @Get('filter-options')
  async getFilterOptions(@Req() req?: any): Promise<{
    departments: Array<{ value: number; label: string; users: Array<{ value: number; label: string }> }>;
    products: Array<{ value: number; label: string }>;
  }> {
    return this.orderService.getFilterOptions(req.user);
  }

  @Get(':id')
  async findById(
    @Param('id', ParseIntPipe) id: number,
    @Req() req?: any,
  ): Promise<Order | null> {
    return this.orderService.findByIdWithPermission(id, req.user);
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

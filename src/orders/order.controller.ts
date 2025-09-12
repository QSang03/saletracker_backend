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
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrderService } from './order.service';
import { Order } from './order.entity';
import { OrderDetail } from 'src/order-details/order-detail.entity';
import {
  OverviewStatsResponse,
  StatusStatsResponse,
  EmployeeStatsResponse,
  CustomerStatsResponse,
} from './order.service';

@Controller('orders')
@UseGuards(AuthGuard('jwt'))
export class OrderController {
  private readonly logger = new Logger(OrderController.name);
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
    @Query('brands') brands?: string,
    @Query('categories') categories?: string,
    @Query('brandCategories') brandCategories?: string,
    @Query('warningLevel') warningLevel?: string,
    @Query('sortField')
    sortField?:
      | 'quantity'
      | 'unit_price'
      | 'created_at'
      | 'conversation_start'
      | 'conversation_end',
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
    @Query('quantity') quantity?: string,
    @Query('conversationType') conversationType?: string,
    @Query('includeHidden') includeHidden?: string,
    @Req() req?: any,
  ): Promise<{
    data: OrderDetail[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(
      1000000,
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
      brands,
      categories,
      brandCategories,
      warningLevel,
      quantity,
      conversationType,
      sortField: sortField || null,
      sortDirection: sortDirection || null,
      includeHidden,
      user: req.user,
    });
  }

  @Get('pm-transactions')
  async findAllForPMTransactions(
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
    @Query('brands') brands?: string,
    @Query('categories') categories?: string,
    @Query('brandCategories') brandCategories?: string,
    @Query('warningLevel') warningLevel?: string,
    @Query('sortField')
    sortField?:
      | 'quantity'
      | 'unit_price'
      | 'created_at'
      | 'conversation_start'
      | 'conversation_end',
    @Query('sortDirection') sortDirection?: 'asc' | 'desc',
    @Query('quantity') quantity?: string,
    @Query('conversationType') conversationType?: string,
    @Query('includeHidden') includeHidden?: string,
    @Req() req?: any,
  ): Promise<{
    data: OrderDetail[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSizeNum = Math.min(
      1000000,
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
    return this.orderService.findAllPaginatedForPM({
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
      brands,
      categories,
      brandCategories,
      warningLevel,
      quantity,
      conversationType,
      sortField: sortField || null,
      sortDirection: sortDirection || null,
      includeHidden,
      user: req.user,
    });
  }

  @Get('all')
  async findAllWithPermission(@Req() req?: any): Promise<Order[]> {
    return this.orderService.findAll();
  }

  @Get('filter-options')
  async getFilterOptions(@Req() req?: any): Promise<{
    departments: Array<{
      value: number;
      label: string;
      users: Array<{ value: number; label: string }>;
    }>;
    products: Array<{ value: number; label: string }>;
  }> {
    return this.orderService.getFilterOptions(req.user);
  }

  @Get('pm-transactions/filter-options')
  async getFilterOptionsForPM(@Req() req?: any): Promise<{
    departments: Array<{
      value: number;
      label: string;
      users: Array<{ value: number; label: string }>;
    }>;
    products: Array<{ value: number; label: string }>;
  }> {
    return this.orderService.getFilterOptionsForPM(req.user);
  }

  // =============== Stats endpoints ===============
  @Get('stats/overview')
  async getOverviewStats(
    @Query('period') period: string = 'day',
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('employees') employees?: string,
    @Query('departments') departments?: string,
    @Req() req?: any,
  ): Promise<OverviewStatsResponse> {
    return this.orderService.getOverviewStats({
      period,
      date,
      dateFrom,
      dateTo,
      employees,
      departments,
      user: req.user,
    });
  }

  @Get('stats/by-status')
  async getStatusStats(
    @Query('period') period: string = 'day',
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('employees') employees?: string,
    @Query('departments') departments?: string,
    @Query('status') status?: string,
    @Req() req?: any,
  ): Promise<StatusStatsResponse> {
    return this.orderService.getStatusStats({
      period,
      date,
      dateFrom,
      dateTo,
      employees,
      departments,
      status,
      user: req.user,
    });
  }

  @Get('stats/by-employee')
  async getEmployeeStats(
    @Query('period') period: string = 'day',
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('employees') employees?: string,
    @Query('departments') departments?: string,
    @Req() req?: any,
  ): Promise<EmployeeStatsResponse> {
    return this.orderService.getEmployeeStats({
      period,
      date,
      dateFrom,
      dateTo,
      employees,
      departments,
      user: req.user,
    });
  }

  @Get('stats/by-customer')
  async getCustomerStats(
    @Query('period') period: string = 'day',
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('employees') employees?: string,
    @Query('departments') departments?: string,
    @Req() req?: any,
  ): Promise<CustomerStatsResponse> {
    return this.orderService.getCustomerStats({
      period,
      date,
      dateFrom,
      dateTo,
      employees,
      departments,
      user: req.user,
    });
  }

  @Get('stats/expired-today')
  async getExpiredTodayStats(
    @Query('employees') employees?: string,
    @Query('departments') departments?: string,
    @Req() req?: any,
  ): Promise<any> {
    return this.orderService.getExpiredTodayStats({
      employees,
      departments,
      user: req.user,
    });
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
